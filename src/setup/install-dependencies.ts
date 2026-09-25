import { executeCommand } from '../execution/execute-command.js';
import type { DependencyInstallPlan, DependencyInstallationResult } from './types.js';

export async function installDependencies(
  plan: DependencyInstallPlan,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<DependencyInstallationResult> {
  const result = await executeCommand({
    command: plan.command,
    cwd: plan.workingDirectory,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.env ? { env: options.env } : {}),
  });
  return {
    ...result,
    packageManager: plan.packageManager,
    ...(plan.version ? { version: plan.version } : {}),
    lockfile: plan.lockfile,
    immutable: true,
  };
}
