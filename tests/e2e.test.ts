import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectProject, prepareAndInstall, runCapabilities } from '../src/index.js';
import type { CiConfig, ResolvedCiPlan } from '../src/index.js';
import { createFakeToolchain } from './fake-toolchain.js';

const fixtureRoot = resolve(import.meta.dirname, '../fixtures/execution');
const recorder = resolve(fixtureRoot, 'record-capability.mjs');
const roots: string[] = [];
const toolchains: Awaited<ReturnType<typeof createFakeToolchain>>[] = [];

async function project(scripts: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'shared-ci-e2e-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'e2e-test', scripts }));
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ name: 'e2e-test', lockfileVersion: 3, packages: {} }),
  );
  return realpath(root);
}

function recordCommand(name: string): string {
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(recorder)} ${JSON.stringify(name)}`;
}

async function plan(root: string, config: CiConfig): Promise<ResolvedCiPlan> {
  const resolution = await inspectProject(root, config);
  if (!resolution.ok)
    throw new Error(resolution.diagnostics.map(({ message }) => message).join('; '));
  return resolution.value;
}

async function run(
  root: string,
  config: CiConfig,
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs = 2000,
) {
  const logPath = join(root, 'order.log');
  const result = await runCapabilities(await plan(root, config), {
    projectRoot: root,
    timeoutMs,
    env: { ...extraEnv, CORE_CAPABILITY_LOG: logPath },
  });
  return {
    result,
    order: (await readFile(logPath, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean),
  };
}

const successfulCore: CiConfig = {
  'lint-command': recordCommand('lint'),
  'typecheck-command': recordCommand('typecheck'),
  'unit-command': recordCommand('unit'),
  'integration-command': recordCommand('integration'),
  'build-command': recordCommand('build'),
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(toolchains.splice(0).map((toolchain) => toolchain.cleanup()));
});

describe('opt-in E2E orchestration', () => {
  it('keeps E2E explicitly disabled by default even when test:e2e exists', async () => {
    const root = await project({ 'test:e2e': recordCommand('e2e') });
    const { result, order } = await run(root, successfulCore, {});
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration', 'build']);
    expect(result.capabilities.e2e).toMatchObject({
      discoveryState: 'DISABLED',
      executionStatus: 'SKIPPED',
      skipReason: 'DISABLED',
    });
  });

  it('does not activate E2E from e2e-command alone and keeps resolver validation authoritative', async () => {
    const root = await project();
    const resolution = await inspectProject(root, { 'e2e-command': recordCommand('e2e') });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok)
      expect(resolution.diagnostics.map(({ code }) => code)).toContain(
        'DISABLED_CAPABILITY_HAS_OVERRIDE',
      );
    expect(await readFile(join(root, 'order.log'), 'utf8').catch(() => '')).toBe('');
  });

  it('runs a detected test:e2e only after the full core sequence when explicitly enabled', async () => {
    const root = await project({ 'test:e2e': recordCommand('e2e') });
    const { result, order } = await run(root, { ...successfulCore, e2e: 'true' });
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration', 'build', 'e2e']);
    expect(result).toMatchObject({
      status: 'PASSED',
      capabilities: {
        e2e: { discoveryState: 'DETECTED', executionStatus: 'PASSED' },
      },
    });
    expect(Object.keys(result.capabilities)).toEqual([
      'lint',
      'typecheck',
      'unit',
      'integration',
      'build',
      'e2e',
    ]);
  });

  it('executes an enabled opaque override unchanged', async () => {
    const root = await project();
    const command = recordCommand('e2e');
    const { result, order } = await run(root, {
      ...successfulCore,
      e2e: 'true',
      'e2e-command': command,
    });
    expect(order.at(-1)).toBe('e2e');
    expect(result.capabilities.e2e).toMatchObject({
      discoveryState: 'OVERRIDDEN',
      executionStatus: 'PASSED',
      command,
    });
  });

  it('fails preflight when E2E is enabled without a command or test:e2e script', async () => {
    const root = await project();
    const resolution = await inspectProject(root, { e2e: 'true' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok)
      expect(resolution.diagnostics.map(({ code }) => code)).toContain(
        'REQUIRED_CAPABILITY_MISSING',
      );
  });

  it('skips enabled E2E after any earlier executable failure and continues independent checks', async () => {
    const root = await project({ 'test:e2e': recordCommand('e2e') });
    const { result, order } = await run(
      root,
      { ...successfulCore, e2e: 'true' },
      { CORE_CAPABILITY_FAILURES: 'typecheck' },
    );
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration']);
    expect(result.capabilities.unit.executionStatus).toBe('PASSED');
    expect(result.capabilities.integration.executionStatus).toBe('PASSED');
    expect(result.capabilities.build).toMatchObject({
      executionStatus: 'SKIPPED',
      skipReason: 'PREREQUISITE_FAILED',
    });
    expect(result.capabilities.e2e).toMatchObject({
      discoveryState: 'DETECTED',
      executionStatus: 'SKIPPED',
      skipReason: 'PREREQUISITE_FAILED',
    });
    expect(result.status).toBe('FAILED');
  });

  it('skips E2E after a build failure', async () => {
    const root = await project({ 'test:e2e': recordCommand('e2e') });
    const { result, order } = await run(
      root,
      { ...successfulCore, e2e: 'true' },
      { CORE_CAPABILITY_FAILURES: 'build' },
    );
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration', 'build']);
    expect(result.capabilities.build.executionStatus).toBe('FAILED');
    expect(result.capabilities.e2e.skipReason).toBe('PREREQUISITE_FAILED');
    expect(result.status).toBe('FAILED');
  });

  it('skips E2E after a build timeout', async () => {
    const root = await project({ 'test:e2e': recordCommand('e2e') });
    const { result, order } = await run(
      root,
      { ...successfulCore, e2e: 'true' },
      { CORE_CAPABILITY_TIMEOUT: 'build' },
    );
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration', 'build']);
    expect(result.capabilities.build.executionStatus).toBe('TIMED_OUT');
    expect(result.capabilities.e2e.skipReason).toBe('PREREQUISITE_FAILED');
  });

  it('allows E2E when build is absent or disabled and other checks succeed', async () => {
    for (const buildMode of ['auto', 'false'] as const) {
      const root = await project({ 'test:e2e': recordCommand('e2e') });
      const { result, order } = await run(root, {
        e2e: 'true',
        build: buildMode,
        'unit-command': recordCommand('unit'),
      });
      expect(order).toEqual(['unit', 'e2e']);
      expect(result.capabilities.build).toMatchObject({
        executionStatus: 'SKIPPED',
        skipReason: buildMode === 'auto' ? 'ABSENT' : 'DISABLED',
      });
      expect(result.capabilities.e2e.executionStatus).toBe('PASSED');
      expect(result.status).toBe('PASSED');
    }
  });

  it('aggregates an E2E command failure', async () => {
    const root = await project({ 'test:e2e': recordCommand('e2e') });
    const { result } = await run(
      root,
      { ...successfulCore, e2e: 'true' },
      { CORE_CAPABILITY_FAILURES: 'e2e' },
    );
    expect(result.capabilities.e2e).toMatchObject({ executionStatus: 'FAILED', exitCode: 29 });
    expect(result.status).toBe('FAILED');
  });

  it('preserves E2E exit code and stderr through the shared executor', async () => {
    const root = await project();
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(fixtureRoot, 'failure.mjs'))}`;
    const { result } = await run(root, { e2e: 'true', 'e2e-command': command });
    expect(result.capabilities.e2e).toMatchObject({
      executionStatus: 'FAILED',
      exitCode: 42,
      stderr: 'known failure\n',
    });
  });

  it('uses the existing timeout behavior for E2E', async () => {
    const root = await project({ 'test:e2e': recordCommand('e2e') });
    const { result } = await run(root, { e2e: 'true' }, { CORE_CAPABILITY_TIMEOUT: 'e2e' }, 250);
    expect(result.capabilities.e2e.executionStatus).toBe('TIMED_OUT');
    expect(result.status).toBe('FAILED');
  });

  it('preserves nested working directory and prepared environment for E2E', async () => {
    const root = await project();
    const nested = join(root, 'apps', 'web');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'package.json'), JSON.stringify({ name: 'web', scripts: {} }));
    await writeFile(
      join(nested, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: {} }),
    );
    const bin = join(root, 'prepared-bin');
    const probe = `process.stdout.write(process.cwd() + '|' + process.env.PATH.includes(process.argv[1]))`;
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(probe)} ${JSON.stringify(bin)}`;
    const result = await run(
      root,
      {
        'working-directory': 'apps/web',
        e2e: 'true',
        'e2e-command': command,
      },
      { PATH: `${bin}:${process.env.PATH}` },
    );
    expect(result.result.capabilities.e2e.workingDirectory).toBe(nested);
    expect(result.result.capabilities.e2e.stdout).toBe(`${nested}|true`);
  });

  it('passes the package-manager preparation PATH to E2E', async () => {
    const toolchain = await createFakeToolchain();
    toolchains.push(toolchain);
    const root = resolve(import.meta.dirname, '../fixtures/pnpm');
    const expectedBin = join(toolchain.tools, 'node_modules/.bin');
    const probe = `process.stdout.write(process.env.PATH.includes(process.argv[1]) ? 'prepared-path-present' : 'prepared-path-missing')`;
    const resolution = await inspectProject(root, {
      lint: 'false',
      typecheck: 'false',
      unit: 'false',
      integration: 'false',
      build: 'false',
      e2e: 'true',
      'e2e-command': `${JSON.stringify(process.execPath)} -e ${JSON.stringify(probe)} ${JSON.stringify(expectedBin)}`,
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error('Expected the pnpm fixture to resolve.');
    const install = await prepareAndInstall(resolution.value, {
      projectRoot: root,
      toolingDirectory: toolchain.tools,
      actualNodeVersion: process.version,
      timeoutMs: 3000,
      env: toolchain.env,
    });
    expect(install.status).toBe('PASSED');
    const result = await runCapabilities(resolution.value, {
      projectRoot: root,
      timeoutMs: 3000,
      env: { ...toolchain.env, ...install.preparation?.environment },
    });
    expect(result.capabilities.e2e).toMatchObject({
      discoveryState: 'OVERRIDDEN',
      executionStatus: 'PASSED',
      stdout: 'prepared-path-present',
    });
  });
});
