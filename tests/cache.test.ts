import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSetupPlan,
  inspectProject,
  managerVersionForCache,
  preparePackageManager,
  resolvePackageManagerCachePath,
  resolvePackageManagerCachePlan,
} from '../src/index.js';
import type { ResolvedCiPlan } from '../src/index.js';
import { createFakeToolchain } from './fake-toolchain.js';

const fixtures = resolve(import.meta.dirname, '../fixtures');
const toolchains: Awaited<ReturnType<typeof createFakeToolchain>>[] = [];
afterEach(async () => Promise.all(toolchains.splice(0).map((tools) => tools.cleanup())));

async function project(name: string, config: Parameters<typeof inspectProject>[1] = {}) {
  const result = await inspectProject(resolve(fixtures, name), config);
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
  return result.value;
}

async function preparedManager(name: string) {
  const tools = await createFakeToolchain();
  toolchains.push(tools);
  const ciPlan = await project(name);
  const setup = await createSetupPlan(ciPlan, {
    projectRoot: resolve(fixtures, name),
    toolingDirectory: tools.tools,
  });
  if (!setup.ok) throw new Error(setup.diagnostics.map(({ message }) => message).join('; '));
  const preparation = await preparePackageManager(setup.value, { env: tools.env });
  expect(preparation.status).toBe('PASSED');
  return { tools, ciPlan, setup: setup.value, preparation };
}

async function cachePlan(
  fixture: string,
  ciPlan: ResolvedCiPlan,
  managerVersion: string,
  cachePath: string,
) {
  const lockfile = resolve(
    fixtures,
    fixture,
    ciPlan.project.workingDirectory,
    ciPlan.packageManager.lockfile,
  );
  return resolvePackageManagerCachePlan(ciPlan, {
    cachePath,
    managerVersion,
    platform: 'linux',
    architecture: 'x64',
    lockfileContents: await readFile(lockfile),
  });
}

describe('pure package-manager cache planning', () => {
  it.each([
    ['npm-minimal', 'npm', '11.19.0', 'package-lock.json'],
    ['pnpm', 'pnpm', '9.15.4', 'pnpm-lock.yaml'],
    ['yarn', 'yarn', '4.5.3', 'yarn.lock'],
  ] as const)(
    'plans %s using its manager and lockfile identity',
    async (fixture, manager, version, lockfile) => {
      const ciPlan = await project(fixture);
      const first = await cachePlan(fixture, ciPlan, version, '/tmp/package-cache');
      const second = await cachePlan(fixture, ciPlan, version, '/tmp/package-cache');
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        enabled: true,
        manager,
        managerVersion: version,
        lockfile,
        cachePath: '/tmp/package-cache',
        restoreKeys: [],
      });
      expect(first.primaryKey).toContain(`-${manager}-${version}-`);
      expect(first.primaryKey).toContain(first.lockfileHash);
    },
  );

  it('invalidates for a lockfile or manager-version change but not a Node selector change', async () => {
    const plan = await project('pnpm');
    const first = await cachePlan('pnpm', plan, '9.15.4', '/tmp/store');
    const changedLock = resolvePackageManagerCachePlan(plan, {
      cachePath: '/tmp/store',
      managerVersion: '9.15.4',
      platform: 'linux',
      architecture: 'x64',
      lockfileContents: 'different lock content',
    });
    const changedManager = await cachePlan('pnpm', plan, '10.0.0', '/tmp/store');
    const changedNode = await cachePlan(
      'pnpm',
      { ...plan, node: { ...plan.node, selector: '26' } },
      '9.15.4',
      '/tmp/store',
    );
    expect(changedLock.primaryKey).not.toBe(first.primaryKey);
    expect(changedManager.primaryKey).not.toBe(first.primaryKey);
    expect(changedNode.primaryKey).toBe(first.primaryKey);
  });

  it('resolves a nested standalone project lockfile from its selected working directory', async () => {
    const plan = await project('nested-working-directory', { 'working-directory': 'app' });
    const lockfilePath = resolve(fixtures, 'nested-working-directory/app/package-lock.json');
    const setup = await createSetupPlan(plan, {
      projectRoot: resolve(fixtures, 'nested-working-directory'),
      toolingDirectory: '/tmp/shared-ci-cache-test-tools',
    });
    if (!setup.ok) throw new Error(setup.diagnostics.map(({ message }) => message).join('; '));
    expect(setup.value.install.lockfile).toBe(lockfilePath);
    const nested = resolvePackageManagerCachePlan(plan, {
      cachePath: '/tmp/npm-store',
      managerVersion: '11.19.0',
      platform: 'linux',
      architecture: 'x64',
      lockfileContents: await readFile(setup.value.install.lockfile),
    });
    const wrongRootLock = await cachePlan(
      'npm-minimal',
      await project('npm-minimal'),
      '11.19.0',
      '/tmp/npm-store',
    );
    expect(nested.lockfileHash).not.toBe(wrongRootLock.lockfileHash);
  });

  it('rejects node_modules and unsafe output values as cache targets', async () => {
    const plan = await project('npm-minimal');
    const inputs = {
      managerVersion: '11.19.0',
      platform: 'linux',
      architecture: 'x64',
      lockfileContents: '{}',
    };
    expect(() =>
      resolvePackageManagerCachePlan(plan, { ...inputs, cachePath: '/tmp/app/node_modules/store' }),
    ).toThrow('node_modules');
    expect(() =>
      resolvePackageManagerCachePlan(plan, { ...inputs, cachePath: '/tmp/cache\nINJECT=1' }),
    ).toThrow('single-line');
  });
});

describe('manager-specific cache path discovery', () => {
  it.each([
    ['npm-minimal', 'npm', ['config', 'get', 'cache']],
    ['pnpm', 'pnpm', ['store', 'path']],
    ['yarn', 'yarn', ['config', 'get', 'enableGlobalCache']],
  ] as const)(
    'queries %s using its prepared executable',
    async (fixture, manager, expectedArgs) => {
      const { tools, ciPlan, setup, preparation } = await preparedManager(fixture);
      const result = await resolvePackageManagerCachePath(setup, {
        ...tools.env,
        ...preparation.environment,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      const call = (await tools.calls()).find(
        (item) => item.tool === manager && item.args[0] !== '--version',
      );
      expect(call?.args.slice(0, expectedArgs.length)).toEqual(expectedArgs);
      expect(result.path).toBe(absoluteTarget(manager, tools.root));
      expect(
        managerVersionForCache(
          manager,
          ciPlan.packageManager.version,
          preparation.actualVersion ?? '',
        ),
      ).toBe(manager === 'npm' ? preparation.actualVersion : ciPlan.packageManager.version);
      expect(ciPlan.packageManager.name).toBe(manager);
    },
  );

  it('honors Yarn 4 local cacheFolder when global caching is disabled', async () => {
    const { tools, setup, preparation } = await preparedManager('yarn');
    const result = await resolvePackageManagerCachePath(setup, {
      ...tools.env,
      ...preparation.environment,
      FAKE_YARN_ENABLE_GLOBAL_CACHE: 'false',
    });
    expect(result).toEqual({ ok: true, path: resolve(setup.projectDirectory, '.yarn/cache') });
    expect(
      (await tools.calls()).map(({ args }) => args).filter(([arg]) => arg === 'config'),
    ).toContainEqual(['config', 'get', 'cacheFolder']);
  });

  it('rejects manager cache locations inside node_modules', async () => {
    const { tools, setup, preparation } = await preparedManager('pnpm');
    const result = await resolvePackageManagerCachePath(setup, {
      ...tools.env,
      ...preparation.environment,
      FAKE_PNPM_STORE_PATH: resolve(setup.projectDirectory, 'node_modules/store'),
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('node_modules') });
  });
});

function absoluteTarget(manager: string, root: string): string {
  if (manager === 'npm') return resolve(root, 'npm-cache/_cacache');
  if (manager === 'pnpm') return resolve(root, 'pnpm-store');
  return resolve(root, 'yarn-global/cache');
}
