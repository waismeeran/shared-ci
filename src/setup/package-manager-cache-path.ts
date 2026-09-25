import { isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { relative } from 'node:path';
import type { PackageManagerName } from '../config/types.js';
import { executeCommand } from '../execution/execute-command.js';
import type { CommandExecutionResult } from '../execution/types.js';
import type { SetupPlan } from './types.js';

export type CachePathResolution =
  Readonly<{ ok: true; path: string }> | Readonly<{ ok: false; message: string }>;

type CommandRunner = (
  command: string,
  plan: SetupPlan,
  env: NodeJS.ProcessEnv,
) => Promise<CommandExecutionResult>;

const runCommand: CommandRunner = (command, plan, env) =>
  executeCommand({ command, cwd: plan.projectDirectory, timeoutMs: 15_000, env });

/** Resolve the cache directory through the exact manager executable used for installs. */
export async function resolvePackageManagerCachePath(
  plan: SetupPlan,
  preparedEnvironment: NodeJS.ProcessEnv,
  runner: CommandRunner = runCommand,
): Promise<CachePathResolution> {
  let pathValue: string;
  switch (plan.packageManager.name) {
    case 'npm': {
      const result = await runner('npm config get cache', plan, preparedEnvironment);
      if (result.status !== 'PASSED') return failed('npm config get cache', result);
      const root = result.stdout.trim();
      if (!root) return { ok: false, message: 'npm returned an empty configured cache path.' };
      pathValue = join(root, '_cacache');
      break;
    }
    case 'pnpm': {
      const result = await runner('pnpm store path', plan, preparedEnvironment);
      if (result.status !== 'PASSED') return failed('pnpm store path', result);
      pathValue = result.stdout.trim();
      break;
    }
    case 'yarn': {
      const globalCache = await runner(
        'yarn config get enableGlobalCache',
        plan,
        preparedEnvironment,
      );
      if (globalCache.status !== 'PASSED')
        return failed('yarn config get enableGlobalCache', globalCache);
      // Yarn may color config output when run in an interactive CI terminal.
      const enabled = stripAnsi(globalCache.stdout).trim().toLowerCase();
      if (enabled === 'true') {
        const globalFolder = await runner(
          'yarn config get globalFolder',
          plan,
          preparedEnvironment,
        );
        if (globalFolder.status !== 'PASSED')
          return failed('yarn config get globalFolder', globalFolder);
        const folder = globalFolder.stdout.trim();
        if (!folder) return { ok: false, message: 'Yarn returned an empty globalFolder.' };
        pathValue = join(
          isAbsolute(folder) ? folder : resolve(plan.projectDirectory, folder),
          'cache',
        );
      } else if (enabled === 'false') {
        const cacheFolder = await runner('yarn config get cacheFolder', plan, preparedEnvironment);
        if (cacheFolder.status !== 'PASSED')
          return failed('yarn config get cacheFolder', cacheFolder);
        const folder = cacheFolder.stdout.trim();
        if (!folder) return { ok: false, message: 'Yarn returned an empty cacheFolder.' };
        pathValue = isAbsolute(folder) ? folder : resolve(plan.projectDirectory, folder);
      } else {
        return {
          ok: false,
          message: `Yarn returned an invalid enableGlobalCache value: ${enabled || '(empty)'}.`,
        };
      }
      break;
    }
  }

  if (!pathValue || /[\r\n]/.test(pathValue))
    return { ok: false, message: 'The package manager returned an empty or multiline cache path.' };
  const absolutePath = resolve(pathValue);
  if (!isAbsolute(pathValue))
    return {
      ok: false,
      message: 'The package manager cache path was not absolute after resolution.',
    };
  if (absolutePath.split(sep).some((part) => part.toLowerCase() === 'node_modules'))
    return { ok: false, message: 'The resolved package-manager cache path includes node_modules.' };
  if (containsPath(absolutePath, plan.projectDirectory))
    return {
      ok: false,
      message:
        'The resolved cache path contains the project root and is too broad to cache safely.',
    };
  if (containsPath(absolutePath, homedir()))
    return {
      ok: false,
      message:
        'The resolved cache path contains the runner home directory and is too broad to cache safely.',
    };
  return { ok: true, path: absolutePath };
}

function containsPath(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return childRelative === '' || (!childRelative.startsWith(`..${sep}`) && childRelative !== '..');
}

function stripAnsi(value: string): string {
  const controlSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  return value.replace(controlSequence, '');
}

function failed(command: string, result: CommandExecutionResult): CachePathResolution {
  const error = result.error?.message;
  return {
    ok: false,
    message: `${command} could not resolve a cache directory (${result.status}${error ? `: ${error}` : ''}).`,
  };
}

export function managerVersionForCache(
  manager: PackageManagerName,
  declaredVersion: string | undefined,
  npmActualVersion: string,
): string {
  if (manager === 'npm') return npmActualVersion;
  if (!declaredVersion)
    throw new Error(`${manager} cache planning requires its exact resolved version.`);
  return declaredVersion;
}
