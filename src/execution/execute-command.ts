import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CommandExecutionResult, ExecuteCommandOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const TERMINATION_GRACE_MS = 250;

/**
 * Runs opaque consumer commands through a fixed Bash argv (`-e -o pipefail -c`).
 * The command is one argv value; Shared CI adds no event, branch, or diagnostic data.
 * Detached process groups let timeout cleanup terminate the shell and its children on Ubuntu.
 */
export async function executeCommand(
  options: ExecuteCommandOptions,
): Promise<CommandExecutionResult> {
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = { command: options.command, workingDirectory: resolve(options.cwd) };
  if (typeof options.command !== 'string' || options.command.trim().length === 0) {
    return {
      ...base,
      status: 'FAILED',
      exitCode: null,
      durationMs: elapsed(started),
      stdout: '',
      stderr: '',
      error: { code: 'INVALID_EXECUTION_COMMAND', message: 'Command must be a non-empty string.' },
    };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      ...base,
      status: 'FAILED',
      exitCode: null,
      durationMs: elapsed(started),
      stdout: '',
      stderr: '',
      error: {
        code: 'INVALID_EXECUTION_COMMAND',
        message: 'timeoutMs must be a positive finite number.',
      },
    };
  }
  try {
    if (!(await stat(options.cwd)).isDirectory()) throw new Error('not a directory');
    await realpath(options.cwd);
  } catch {
    return {
      ...base,
      status: 'FAILED',
      exitCode: null,
      durationMs: elapsed(started),
      stdout: '',
      stderr: '',
      error: {
        code: 'EXECUTION_WORKING_DIRECTORY_NOT_FOUND',
        message: `Execution working directory does not exist or is not a directory: ${options.cwd}`,
      },
    };
  }

  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', options.command], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
      killTimer = setTimeout(() => terminate(child, 'SIGKILL'), TERMINATION_GRACE_MS);
    }, timeoutMs);
    const finish = (result: CommandExecutionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer && !timedOut) clearTimeout(killTimer);
      resolveResult(result);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });
    child.once('error', (error) =>
      finish({
        ...base,
        status: timedOut ? 'TIMED_OUT' : 'FAILED',
        exitCode: null,
        durationMs: elapsed(started),
        stdout,
        stderr,
        error: { code: 'COMMAND_SPAWN_FAILED', message: error.message },
      }),
    );
    child.once('close', (code, signal) => {
      const status = timedOut ? 'TIMED_OUT' : code === 0 ? 'PASSED' : 'FAILED';
      finish({
        ...base,
        status,
        exitCode: code,
        ...(signal ? { signal } : {}),
        durationMs: elapsed(started),
        stdout,
        stderr,
      });
    });
  });
}

function terminate(child: ReturnType<typeof spawn>, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    // The process may already have exited between timeout and group signaling.
    void error;
  }
}
function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

/** Checks that a selected project path remains inside its expected root, including symlinks. */
export async function resolveExecutionDirectory(
  projectRoot: string,
  projectDirectory: string,
): Promise<string | undefined> {
  if (isAbsolute(projectDirectory)) return undefined;
  const root = resolve(projectRoot);
  const directory = resolve(root, projectDirectory);
  const lexical = relative(root, directory);
  if (lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) return undefined;
  try {
    const [realRoot, realDirectory] = await Promise.all([realpath(root), realpath(directory)]);
    const actual = relative(realRoot, realDirectory);
    if (actual === '..' || actual.startsWith(`..${sep}`) || isAbsolute(actual)) return undefined;
    if (!(await stat(realDirectory)).isDirectory()) return undefined;
    return realDirectory;
  } catch {
    return undefined;
  }
}
