import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDependencyInstallPlan,
  createSetupPlan,
  inspectProject,
  prepareAndInstall,
  preparePackageManager,
  runtimeRequirement,
  verifyCorepackRuntime,
  verifyNodeRuntime,
} from '../src/index.js';
import type { ResolvedCiPlan } from '../src/index.js';
import { createFakeToolchain } from './fake-toolchain.js';

const fixtures = resolve(import.meta.dirname, '../fixtures');
const toolchains: Awaited<ReturnType<typeof createFakeToolchain>>[] = [];
async function fakeTools() {
  const tools = await createFakeToolchain();
  toolchains.push(tools);
  return tools;
}
async function planFor(name: string): Promise<ResolvedCiPlan> {
  const result = await inspectProject(resolve(fixtures, name));
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
  return result.value;
}
afterEach(async () => {
  await Promise.all(toolchains.splice(0).map((tools) => tools.cleanup()));
});

describe('runtime requirement verification', () => {
  it('checks numeric major, minor and patch selectors without a general semver engine', () => {
    const requirement = runtimeRequirement({
      ...minimalPlan(),
      node: { selector: '24.15.2', source: 'input' },
    });
    expect(verifyNodeRuntime(requirement, 'v24.15.2')).toMatchObject({ status: 'PASSED' });
    expect(verifyNodeRuntime({ ...requirement, selector: '24.15' }, 'v24.15.9')).toMatchObject({
      status: 'PASSED',
    });
    expect(verifyNodeRuntime({ ...requirement, selector: '24' }, 'v24.19.0')).toMatchObject({
      status: 'PASSED',
    });
    expect(verifyNodeRuntime(requirement, 'v24.15.1')).toMatchObject({
      status: 'FAILED',
      diagnostic: { code: 'NODE_RUNTIME_MISMATCH' },
    });
  });
  it('reports incompatible runtime and leaves unsupported selector interpretation explicit', () => {
    expect(
      verifyNodeRuntime({ runtime: 'node', selector: '24', source: 'shared-default' }, 'v22.22.2'),
    ).toMatchObject({ status: 'FAILED' });
    expect(
      verifyNodeRuntime({ runtime: 'node', selector: 'lts/*', source: 'input' }, 'v24.19.0'),
    ).toMatchObject({ status: 'UNSUPPORTED', diagnostic: { code: 'UNSUPPORTED_NODE_SELECTOR' } });
  });
  it('checks the pinned Corepack Node floors', () => {
    expect(verifyCorepackRuntime('v22.22.2')).toBeUndefined();
    expect(verifyCorepackRuntime('v24.14.9')?.code).toBe('COREPACK_NODE_VERSION_UNSUPPORTED');
    expect(verifyCorepackRuntime('v24.15.0')).toBeUndefined();
    expect(verifyCorepackRuntime('v26.0.0')).toBeUndefined();
    expect(verifyCorepackRuntime('v25.0.0')?.code).toBe('COREPACK_NODE_VERSION_UNSUPPORTED');
  });
});

describe('preparation and immutable install plans', () => {
  it('selects the policy install command and retains lockfile metadata', async () => {
    const npm = await planFor('npm-minimal');
    const pnpm = await planFor('pnpm');
    const yarn = await planFor('yarn');
    expect(createDependencyInstallPlan(npm, resolve(fixtures, 'npm-minimal'))).toMatchObject({
      command: 'npm ci',
      immutable: true,
      lockfile: resolve(fixtures, 'npm-minimal/package-lock.json'),
    });
    expect(createDependencyInstallPlan(pnpm, resolve(fixtures, 'pnpm'))).toMatchObject({
      command: 'pnpm install --frozen-lockfile',
      immutable: true,
      lockfile: resolve(fixtures, 'pnpm/pnpm-lock.yaml'),
    });
    expect(createDependencyInstallPlan(yarn, resolve(fixtures, 'yarn'))).toMatchObject({
      command: 'yarn install --immutable',
      immutable: true,
      lockfile: resolve(fixtures, 'yarn/yarn.lock'),
    });
  });

  it('creates a pinned isolated Corepack setup plan for pnpm and Yarn 4', async () => {
    const tools = await fakeTools();
    const pnpm = await createSetupPlan(await planFor('pnpm'), {
      projectRoot: resolve(fixtures, 'pnpm'),
      toolingDirectory: tools.tools,
    });
    const yarn = await createSetupPlan(await planFor('yarn'), {
      projectRoot: resolve(fixtures, 'yarn'),
      toolingDirectory: tools.tools,
    });
    expect(pnpm).toMatchObject({
      ok: true,
      value: {
        corepackInstallCommand: `npm install --prefix '${tools.tools}' --no-save --no-package-lock corepack@0.36.0`,
        managerActivationCommand: `'${tools.tools}/node_modules/.bin/corepack' install -g pnpm@9.15.4`,
        managerVersionCommand: 'pnpm --version',
        managerInstallCommand: 'pnpm install --frozen-lockfile',
      },
    });
    expect(yarn).toMatchObject({
      ok: true,
      value: {
        managerActivationCommand: `'${tools.tools}/node_modules/.bin/corepack' install -g yarn@4.5.3`,
        managerInstallCommand: 'yarn install --immutable',
      },
    });
  });

  it('requires exact pnpm/Yarn versions and a tooling directory outside the consumer root', async () => {
    const noPin = {
      ...(await planFor('pnpm')),
      packageManager: { name: 'pnpm', source: 'lockfile', lockfile: 'pnpm-lock.yaml' },
    } as unknown as ResolvedCiPlan;
    expect(
      await createSetupPlan(noPin, {
        projectRoot: resolve(fixtures, 'pnpm'),
        toolingDirectory: resolve(fixtures, 'pnpm', '.tools'),
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_TOOLING_DIRECTORY' }] });
    expect(
      await createSetupPlan(noPin, {
        projectRoot: resolve(fixtures, 'pnpm'),
        toolingDirectory: resolve(fixtures, '..', '..', 'tooling'),
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'PACKAGE_MANAGER_VERSION_REQUIRED' }] });
  });
});

describe('isolated package manager preparation', () => {
  it('verifies npm and performs npm ci through the shared executor without changing metadata', async () => {
    const tools = await fakeTools();
    const root = resolve(fixtures, 'npm-minimal');
    const packageBefore = await readFile(resolve(root, 'package.json'), 'utf8');
    const lockBefore = await readFile(resolve(root, 'package-lock.json'), 'utf8');
    const result = await prepareAndInstall(await planFor('npm-minimal'), {
      projectRoot: root,
      toolingDirectory: tools.tools,
      actualNodeVersion: process.version,
      timeoutMs: 3000,
      env: tools.env,
    });
    expect(result).toMatchObject({
      status: 'PASSED',
      runtimeVerification: { status: 'PASSED' },
      preparation: { status: 'PASSED', stage: 'READY', actualVersion: '10.8.2' },
      installation: { status: 'PASSED', command: 'npm ci', exitCode: 0 },
    });
    expect((await tools.calls()).map((call) => [call.tool, call.args])).toEqual([
      ['npm', ['--version']],
      ['npm', ['ci']],
    ]);
    expect(await readFile(resolve(root, 'package.json'), 'utf8')).toBe(packageBefore);
    expect(await readFile(resolve(root, 'package-lock.json'), 'utf8')).toBe(lockBefore);
  });

  it('prepares and verifies pnpm with Corepack 0.36.0, then freezes the install', async () => {
    const tools = await fakeTools();
    const plan = await planFor('pnpm');
    const root = resolve(fixtures, 'pnpm');
    const manifestBefore = await readFile(resolve(root, 'package.json'), 'utf8');
    const lockfileBefore = await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8');
    const result = await prepareAndInstall(plan, {
      projectRoot: root,
      toolingDirectory: tools.tools,
      actualNodeVersion: process.version,
      timeoutMs: 3000,
      env: tools.env,
    });
    expect(result).toMatchObject({
      status: 'PASSED',
      preparation: { status: 'PASSED', stage: 'READY', actualVersion: '9.15.4' },
      installation: { status: 'PASSED', command: 'pnpm install --frozen-lockfile' },
    });
    const calls = await tools.calls();
    expect(
      calls.find((call) => call.tool === 'corepack' && call.args.includes('-g'))?.args,
    ).toEqual(['install', '-g', 'pnpm@9.15.4']);
    expect(calls.find((call) => call.tool === 'pnpm' && call.args[0] === 'install')?.args).toEqual([
      'install',
      '--frozen-lockfile',
    ]);
    expect(await readFile(resolve(root, 'package.json'), 'utf8')).toBe(manifestBefore);
    expect(await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8')).toBe(lockfileBefore);
  });

  it('prepares and verifies Yarn 4, then installs immutably', async () => {
    const tools = await fakeTools();
    const root = resolve(fixtures, 'yarn');
    const manifestBefore = await readFile(resolve(root, 'package.json'), 'utf8');
    const lockfileBefore = await readFile(resolve(root, 'yarn.lock'), 'utf8');
    const result = await prepareAndInstall(await planFor('yarn'), {
      projectRoot: root,
      toolingDirectory: tools.tools,
      actualNodeVersion: process.version,
      timeoutMs: 3000,
      env: tools.env,
    });
    expect(result).toMatchObject({
      status: 'PASSED',
      preparation: { actualVersion: '4.5.3' },
      installation: { status: 'PASSED', command: 'yarn install --immutable' },
    });
    expect(
      (await tools.calls()).find((call) => call.tool === 'yarn' && call.args[0] === 'install')
        ?.args,
    ).toEqual(['install', '--immutable']);
    expect(await readFile(resolve(root, 'package.json'), 'utf8')).toBe(manifestBefore);
    expect(await readFile(resolve(root, 'yarn.lock'), 'utf8')).toBe(lockfileBefore);
  });

  it('reports unusable npm and npm bundled-version mismatches', async () => {
    const tools = await fakeTools();
    const plan = await planFor('npm-full');
    const setup = await createSetupPlan(plan, {
      projectRoot: resolve(fixtures, 'npm-full'),
      toolingDirectory: tools.tools,
    });
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error('Expected the npm fixture setup plan to resolve.');
    // `npm-full` intentionally follows the current Node-bundled npm. Add a
    // synthetic pin here to keep testing the mismatch guard without promising
    // a stale npm version in the consumer fixture.
    const npmSetupPlan = {
      ...setup.value,
      packageManager: { ...setup.value.packageManager, version: '10.8.2' },
    };
    const mismatch = await preparePackageManager(npmSetupPlan, {
      timeoutMs: 1000,
      env: { ...tools.env, FAKE_NPM_VERSION: '11.0.0' },
    });
    expect(mismatch).toMatchObject({
      status: 'FAILED',
      stage: 'NPM_AVAILABILITY',
      diagnostics: [{ code: 'PACKAGE_MANAGER_VERSION_MISMATCH' }],
    });
    const unavailable = await preparePackageManager(npmSetupPlan, {
      timeoutMs: 1000,
      env: { ...tools.env, FAKE_NPM_VERSION_EXIT: '127' },
    });
    expect(unavailable).toMatchObject({
      status: 'FAILED',
      stage: 'NPM_AVAILABILITY',
      diagnostics: [{ code: 'PACKAGE_MANAGER_UNAVAILABLE' }],
    });
  });

  it('distinguishes Corepack installation, availability, version, activation, and manager-version failures', async () => {
    const plan = await planFor('pnpm');
    const scenarios = [
      {
        env: { FAKE_NPM_COREPACK_EXIT: '23' },
        stage: 'COREPACK_INSTALLATION',
        code: 'COREPACK_INSTALLATION_FAILED',
      },
      {
        env: { FAKE_COREPACK_MISSING: '1' },
        stage: 'COREPACK_AVAILABILITY',
        code: 'COREPACK_UNAVAILABLE',
      },
      {
        env: { FAKE_COREPACK_VERSION: '0.35.0' },
        stage: 'COREPACK_VERSION_VERIFICATION',
        code: 'COREPACK_VERSION_MISMATCH',
      },
      {
        env: { FAKE_COREPACK_ACTIVATION_EXIT: '24' },
        stage: 'PACKAGE_MANAGER_ACTIVATION',
        code: 'PACKAGE_MANAGER_PREPARATION_FAILED',
      },
      {
        env: { FAKE_PNPM_VERSION: '10.0.0' },
        stage: 'PACKAGE_MANAGER_VERSION_VERIFICATION',
        code: 'PACKAGE_MANAGER_VERSION_MISMATCH',
      },
    ] as const;
    for (const scenario of scenarios) {
      const tools = await fakeTools();
      const result = await prepareAndInstall(plan, {
        projectRoot: resolve(fixtures, 'pnpm'),
        toolingDirectory: tools.tools,
        actualNodeVersion: process.version,
        timeoutMs: 2000,
        env: { ...tools.env, ...scenario.env },
      });
      expect(result).toMatchObject({
        status: 'FAILED',
        failedAt: 'package-manager-preparation',
        preparation: {
          status: 'FAILED',
          stage: scenario.stage,
          diagnostics: [{ code: scenario.code }],
        },
      });
    }
  });

  it('fails before manager preparation when the Node selector or Corepack floor is unmet', async () => {
    const plan = await planFor('pnpm');
    const nodeMismatch = await prepareAndInstall(plan, {
      projectRoot: resolve(fixtures, 'pnpm'),
      toolingDirectory: resolve(fixtures, 'temporary-tools'),
      actualNodeVersion: 'v22.22.2',
    });
    expect(nodeMismatch).toMatchObject({
      status: 'FAILED',
      failedAt: 'runtime-verification',
      diagnostics: [{ code: 'NODE_RUNTIME_MISMATCH' }],
    });
    const floor = await prepareAndInstall(plan, {
      projectRoot: resolve(fixtures, 'pnpm'),
      toolingDirectory: resolve(fixtures, 'temporary-tools'),
      actualNodeVersion: 'v24.14.9',
    });
    expect(floor).toMatchObject({
      status: 'FAILED',
      failedAt: 'package-manager-preparation',
      diagnostics: [{ code: 'COREPACK_NODE_VERSION_UNSUPPORTED' }],
    });
  });

  it('preserves failed install exit codes and distinguishes install timeouts', async () => {
    const tools = await fakeTools();
    const plan = await planFor('npm-minimal');
    const failure = await prepareAndInstall(plan, {
      projectRoot: resolve(fixtures, 'npm-minimal'),
      toolingDirectory: tools.tools,
      timeoutMs: 1000,
      env: { ...tools.env, FAKE_NPM_INSTALL_EXIT: '37' },
    });
    expect(failure).toMatchObject({
      status: 'FAILED',
      failedAt: 'dependency-installation',
      installation: { status: 'FAILED', exitCode: 37, stderr: 'fake npm ci error\n' },
    });
    const mismatch = await prepareAndInstall(plan, {
      projectRoot: resolve(fixtures, 'npm-minimal'),
      toolingDirectory: tools.tools,
      timeoutMs: 1000,
      env: { ...tools.env, FAKE_NPM_LOCK_MISMATCH: '1' },
    });
    expect(mismatch).toMatchObject({
      status: 'FAILED',
      installation: { status: 'FAILED', exitCode: 1, stderr: 'npm ci lockfile mismatch\n' },
    });
    const timeout = await prepareAndInstall(plan, {
      projectRoot: resolve(fixtures, 'npm-minimal'),
      toolingDirectory: tools.tools,
      timeoutMs: 300,
      env: { ...tools.env, FAKE_NPM_CI_DELAY_MS: '5000' },
    });
    expect(timeout).toMatchObject({
      status: 'TIMED_OUT',
      failedAt: 'dependency-installation',
      installation: { status: 'TIMED_OUT', exitCode: null },
    });
  });
});

function minimalPlan(): ResolvedCiPlan {
  return {
    project: { workingDirectory: '.' },
    node: { selector: '24', source: 'shared-default' },
    packageManager: { name: 'npm', source: 'lockfile', lockfile: 'package-lock.json' },
    capabilities: {} as ResolvedCiPlan['capabilities'],
    diagnostics: [],
  };
}
