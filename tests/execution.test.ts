import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeCapability, executeCommand, inspectProject } from '../src/index.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/execution');
const project = resolve(fixtures, 'project');
const scriptCommand = (name: string): string =>
  `${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(fixtures, name))}`;

describe('command execution', () => {
  it('captures success output and returns PASSED only after a zero exit', async () => {
    const result = await executeCommand({
      command: scriptCommand('success.mjs'),
      cwd: project,
      timeoutMs: 3000,
    });
    expect(result).toMatchObject({
      status: 'PASSED',
      exitCode: 0,
      stdout: 'hello stdout\n',
      stderr: '',
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('preserves non-zero exit codes and stderr', async () => {
    const result = await executeCommand({
      command: scriptCommand('failure.mjs'),
      cwd: project,
      timeoutMs: 3000,
    });
    expect(result).toMatchObject({
      status: 'FAILED',
      exitCode: 42,
      stdout: '',
      stderr: 'known failure\n',
    });
  });

  it('preserves signal termination without inventing an exit code', async () => {
    const result = await executeCommand({
      command: 'kill -TERM $$',
      cwd: project,
      timeoutMs: 3000,
    });
    expect(result).toMatchObject({ status: 'FAILED', exitCode: null, signal: 'SIGTERM' });
  });

  it('keeps stdout and stderr separate and forwards optional stream callbacks', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await executeCommand({
      command: scriptCommand('mixed-output.mjs'),
      cwd: project,
      timeoutMs: 3000,
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
    });
    expect(result).toMatchObject({ status: 'PASSED', stdout: 'out line\n', stderr: 'err line\n' });
    expect(stdout.join('')).toBe(result.stdout);
    expect(stderr.join('')).toBe(result.stderr);
  });

  it('runs with the requested working directory and inherited environment', async () => {
    const cwd = await executeCommand({
      command: scriptCommand('working-directory.mjs'),
      cwd: project,
      timeoutMs: 3000,
    });
    expect(cwd.stdout).toBe(project);
    const env = await executeCommand({
      command: scriptCommand('environment.mjs'),
      cwd: project,
      env: { SHARED_CI_TEST_VALUE: 'inherited plus override' },
      timeoutMs: 3000,
    });
    expect(env.stdout).toBe('inherited plus override');
  });

  it('fails clearly for a missing working directory or invalid command', async () => {
    expect(
      await executeCommand({
        command: scriptCommand('success.mjs'),
        cwd: resolve(fixtures, 'missing'),
        timeoutMs: 1000,
      }),
    ).toMatchObject({
      status: 'FAILED',
      error: { code: 'EXECUTION_WORKING_DIRECTORY_NOT_FOUND' },
      exitCode: null,
    });
    expect(await executeCommand({ command: '   ', cwd: project, timeoutMs: 1000 })).toMatchObject({
      status: 'FAILED',
      error: { code: 'INVALID_EXECUTION_COMMAND' },
    });
  });

  it('times out a long running command and terminates its process group', async () => {
    const result = await executeCommand({
      command: scriptCommand('timeout.mjs'),
      cwd: project,
      timeoutMs: 400,
    });
    expect(result).toMatchObject({
      status: 'TIMED_OUT',
      exitCode: null,
      stdout: 'started timeout fixture\n',
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(300);
    expect(result.durationMs).toBeLessThan(3000);
  });
});

describe('resolved capability execution', () => {
  it('executes detected package scripts through the resolved package manager', async () => {
    const resolution = await inspectProject(project);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const result = await executeCapability(resolution.value, 'unit', {
      projectRoot: project,
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({
      capability: 'unit',
      discoveryState: 'DETECTED',
      executionStatus: 'PASSED',
      stdout: expect.stringContaining('hello stdout\n'),
      exitCode: 0,
    });
  });

  it('executes opaque overrides exactly and does not alter discovery state on failure', async () => {
    const resolution = await inspectProject(project, {
      'build-command': scriptCommand('failure.mjs'),
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const result = await executeCapability(resolution.value, 'build', {
      projectRoot: project,
      timeoutMs: 3000,
    });
    expect(result).toMatchObject({
      discoveryState: 'OVERRIDDEN',
      executionStatus: 'FAILED',
      command: scriptCommand('failure.mjs'),
      exitCode: 42,
    });
  });

  it('returns explicit ABSENT and DISABLED skips without trying to spawn', async () => {
    const absent = await inspectProject(project, { integration: 'auto' });
    expect(absent.ok).toBe(true);
    if (absent.ok)
      expect(
        await executeCapability(absent.value, 'integration', { projectRoot: project }),
      ).toMatchObject({
        discoveryState: 'ABSENT',
        executionStatus: 'SKIPPED',
        skipReason: 'ABSENT',
        durationMs: 0,
      });
    const disabled = await inspectProject(project, { build: 'false' });
    expect(disabled.ok).toBe(true);
    if (disabled.ok)
      expect(
        await executeCapability(disabled.value, 'build', { projectRoot: project }),
      ).toMatchObject({
        discoveryState: 'DISABLED',
        executionStatus: 'SKIPPED',
        skipReason: 'DISABLED',
        durationMs: 0,
      });
  });

  it('enforces project-root containment after plan resolution', async () => {
    const resolution = await inspectProject(fixtures, { 'working-directory': 'project' });
    expect(resolution.ok).toBe(true);
    if (resolution.ok)
      expect(
        await executeCapability(resolution.value, 'unit', {
          projectRoot: project,
          timeoutMs: 1000,
        }),
      ).toMatchObject({
        executionStatus: 'FAILED',
        error: { code: 'EXECUTION_WORKING_DIRECTORY_NOT_FOUND' },
      });
  });
});
