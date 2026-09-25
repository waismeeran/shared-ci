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
  const root = await mkdtemp(join(tmpdir(), 'shared-ci-core-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'core-test', scripts }));
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ name: 'core-test', lockfileVersion: 3, packages: {} }),
  );
  return realpath(root);
}

function recordCommand(name: string): string {
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(recorder)} ${JSON.stringify(name)}`;
}

async function resolvedPlan(root: string, config: CiConfig = {}): Promise<ResolvedCiPlan> {
  const resolution = await inspectProject(root, config);
  if (!resolution.ok)
    throw new Error(resolution.diagnostics.map(({ message }) => message).join('; '));
  return resolution.value;
}

async function recorded(root: string, config: CiConfig = {}, env: NodeJS.ProcessEnv = {}) {
  const plan = await resolvedPlan(root, config);
  const logPath = join(root, 'capabilities.log');
  const result = await runCapabilities(plan, {
    projectRoot: root,
    env: {
      ...env,
      CORE_CAPABILITY_LOG: logPath,
      CORE_CAPABILITY_CWD_LOG: join(root, 'capability-cwd.log'),
    },
    timeoutMs: 2000,
  });
  const log = await readFile(logPath, 'utf8').catch(() => '');
  const cwdLog = await readFile(join(root, 'capability-cwd.log'), 'utf8').catch(() => '');
  return {
    plan,
    result,
    order: log.trim() ? log.trim().split('\n') : [],
    workingDirectories: cwdLog.trim() ? cwdLog.trim().split('\n') : [],
  };
}

const allCommands: CiConfig = {
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

describe('core capability orchestration', () => {
  it('runs resolved capabilities in fixed order with E2E explicitly enabled', async () => {
    const root = await project({
      lint: recordCommand('lint'),
      typecheck: recordCommand('typecheck'),
      'test:unit': recordCommand('unit'),
      'test:integration': recordCommand('integration'),
      build: recordCommand('build'),
      'test:e2e': recordCommand('e2e'),
    });
    const { result, order, plan, workingDirectories } = await recorded(root, {
      e2e: 'true',
    });
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration', 'build', 'e2e']);
    expect(result).toMatchObject({
      status: 'PASSED',
      capabilities: {
        lint: { discoveryState: 'DETECTED', executionStatus: 'PASSED' },
        typecheck: { executionStatus: 'PASSED' },
        unit: { executionStatus: 'PASSED' },
        integration: { executionStatus: 'PASSED' },
        build: { executionStatus: 'PASSED' },
        e2e: { discoveryState: 'DETECTED', executionStatus: 'PASSED' },
      },
    });
    expect(plan.capabilities.e2e).toMatchObject({ state: 'DETECTED' });
    expect(workingDirectories).toEqual(Array.from({ length: 6 }, () => root));
  });

  it('runs every command from the resolved working directory', async () => {
    const root = await project();
    const selected = join(root, 'selected');
    await mkdir(selected);
    await writeFile(
      join(selected, 'package.json'),
      JSON.stringify({ name: 'nested', scripts: {} }),
    );
    await writeFile(
      join(selected, 'package-lock.json'),
      JSON.stringify({ name: 'nested', lockfileVersion: 3, packages: {} }),
    );
    const { result, order, workingDirectories } = await recorded(root, {
      'working-directory': 'selected',
      'unit-command': recordCommand('unit'),
    });
    expect(order).toEqual(['unit']);
    expect(result.capabilities.unit.workingDirectory).toBe(selected);
    expect(workingDirectories).toEqual([selected]);
  });

  it('preserves absent and disabled rows without spawning them, and allows build', async () => {
    const root = await project();
    const { result, order } = await recorded(root, {
      lint: 'false',
      'typecheck-command': recordCommand('typecheck'),
      unit: 'auto',
      'integration-command': recordCommand('integration'),
      'build-command': recordCommand('build'),
    });
    expect(order).toEqual(['typecheck', 'integration', 'build']);
    expect(result).toMatchObject({
      status: 'PASSED',
      capabilities: {
        lint: { discoveryState: 'DISABLED', executionStatus: 'SKIPPED', skipReason: 'DISABLED' },
        unit: { discoveryState: 'ABSENT', executionStatus: 'SKIPPED', skipReason: 'ABSENT' },
        build: { executionStatus: 'PASSED' },
      },
    });
  });

  it('continues independent checks after lint fails and skips build', async () => {
    const root = await project();
    const { result, order } = await recorded(root, allCommands, {
      CORE_CAPABILITY_FAILURES: 'lint',
    });
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration']);
    expect(result.status).toBe('FAILED');
    expect(result.capabilities.lint).toMatchObject({ executionStatus: 'FAILED', exitCode: 29 });
    expect(result.capabilities.typecheck.executionStatus).toBe('PASSED');
    expect(result.capabilities.unit.executionStatus).toBe('PASSED');
    expect(result.capabilities.integration.executionStatus).toBe('PASSED');
    expect(result.capabilities.build).toMatchObject({
      discoveryState: 'OVERRIDDEN',
      executionStatus: 'SKIPPED',
      skipReason: 'PREREQUISITE_FAILED',
    });
  });

  it('keeps an intrinsically absent or disabled build skip when a check fails', async () => {
    for (const buildMode of ['auto', 'false'] as const) {
      const root = await project();
      const config: CiConfig = {
        'lint-command': recordCommand('lint'),
        typecheck: 'false',
        unit: 'false',
        integration: 'false',
        build: buildMode,
      };
      const { result } = await recorded(root, config, { CORE_CAPABILITY_FAILURES: 'lint' });
      expect(result.status).toBe('FAILED');
      expect(result.capabilities.build.executionStatus).toBe('SKIPPED');
      expect(result.capabilities.build.skipReason).toBe(
        buildMode === 'auto' ? 'ABSENT' : 'DISABLED',
      );
    }
  });

  it('collects multiple failures and gates build after unit or integration failure', async () => {
    const root = await project();
    const { result, order } = await recorded(root, allCommands, {
      CORE_CAPABILITY_FAILURES: 'lint,unit',
    });
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration']);
    expect(result.capabilities.lint.executionStatus).toBe('FAILED');
    expect(result.capabilities.unit.executionStatus).toBe('FAILED');
    expect(result.capabilities.build.skipReason).toBe('PREREQUISITE_FAILED');
    for (const failure of ['unit', 'integration']) {
      const scenarioRoot = await project();
      const scenario = await recorded(scenarioRoot, allCommands, {
        CORE_CAPABILITY_FAILURES: failure,
      });
      expect(scenario.result.capabilities.build.executionStatus).toBe('SKIPPED');
      expect(scenario.result.capabilities.build.skipReason).toBe('PREREQUISITE_FAILED');
    }
  });

  it('reports a build failure in the aggregate', async () => {
    const root = await project();
    const { result, order } = await recorded(root, allCommands, {
      CORE_CAPABILITY_FAILURES: 'build',
    });
    expect(order).toEqual(['lint', 'typecheck', 'unit', 'integration', 'build']);
    expect(result).toMatchObject({
      status: 'FAILED',
      capabilities: { build: { executionStatus: 'FAILED', exitCode: 29 } },
    });
  });

  it('continues after a timed-out check once process-group cleanup completes', async () => {
    const root = await project();
    const plan = await resolvedPlan(root, allCommands);
    const logPath = join(root, 'capabilities.log');
    const result = await runCapabilities(plan, {
      projectRoot: root,
      env: { CORE_CAPABILITY_LOG: logPath, CORE_CAPABILITY_TIMEOUT: 'lint' },
      timeoutMs: 250,
    });
    expect(result.capabilities.lint.executionStatus).toBe('TIMED_OUT');
    expect(result.capabilities.typecheck.executionStatus).toBe('PASSED');
    expect(result.capabilities.build.skipReason).toBe('PREREQUISITE_FAILED');
    expect((await readFile(logPath, 'utf8')).trim().split('\n')).toEqual([
      'lint',
      'typecheck',
      'unit',
      'integration',
    ]);
  });

  it('preserves an override command verbatim', async () => {
    const root = await project();
    const custom = `${JSON.stringify(process.execPath)} ${JSON.stringify(recorder)} 'unit'`;
    const result = await recorded(root, { 'unit-command': custom });
    expect(result.result.capabilities.unit.command).toBe(custom);
    expect(result.order).toEqual(['unit']);
  });

  it('carries the package-manager preparation environment through install to execution', async () => {
    const toolchain = await createFakeToolchain();
    toolchains.push(toolchain);
    const root = resolve(import.meta.dirname, '../fixtures/pnpm');
    const expectedBin = join(toolchain.tools, 'node_modules/.bin');
    const probe = `process.stdout.write(process.env.PATH.includes(process.argv[1]) ? 'prepared-path-present' : 'prepared-path-missing')`;
    const planResult = await inspectProject(root, {
      lint: 'false',
      typecheck: 'false',
      'unit-command': `${JSON.stringify(process.execPath)} -e ${JSON.stringify(probe)} ${JSON.stringify(expectedBin)}`,
      integration: 'false',
      build: 'false',
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('Expected the pnpm fixture to resolve.');
    const install = await prepareAndInstall(planResult.value, {
      projectRoot: root,
      toolingDirectory: toolchain.tools,
      actualNodeVersion: process.version,
      timeoutMs: 3000,
      env: toolchain.env,
    });
    expect(install.status).toBe('PASSED');
    const result = await runCapabilities(planResult.value, {
      projectRoot: root,
      timeoutMs: 3000,
      env: { ...toolchain.env, ...install.preparation?.environment },
    });
    expect(result).toMatchObject({
      status: 'PASSED',
      capabilities: {
        unit: {
          discoveryState: 'OVERRIDDEN',
          executionStatus: 'PASSED',
          stdout: 'prepared-path-present',
        },
      },
    });
  });
});
