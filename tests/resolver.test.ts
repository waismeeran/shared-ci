import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inspectProject,
  parsePackageJson,
  resolveCapabilities,
  resolveCiPlan,
  resolveNodeVersion,
  resolvePackageManager,
  validateConfig,
} from '../src/index.js';
import type { PackageManifest } from '../src/index.js';

const scripts: PackageManifest['scripts'] = {
  lint: 'eslint .',
  typecheck: 'tsc',
  test: 'vitest',
  'test:unit': 'vitest unit',
  'test:integration': 'vitest integration',
  build: 'node build.js',
  'test:e2e': 'playwright test',
};
const fixtureRoot = resolve(import.meta.dirname, '../fixtures');

describe('manifest and input validation', () => {
  it('parses useful metadata and reports malformed JSON and fields', () => {
    expect(parsePackageJson('{"scripts":{"lint":"eslint"},"engines":{"node":"24"}}')).toMatchObject(
      { ok: true, value: { scripts: { lint: 'eslint' }, enginesNode: '24' } },
    );
    expect(parsePackageJson('{').diagnostics[0]?.code).toBe('INVALID_PACKAGE_JSON');
    expect(parsePackageJson('{"scripts":{"lint":4}}').diagnostics[0]?.code).toBe(
      'INVALID_PACKAGE_SCRIPTS',
    );
    expect(parsePackageJson('{"packageManager":4}').diagnostics[0]?.code).toBe(
      'MALFORMED_PACKAGE_MANAGER',
    );
    expect(parsePackageJson('{"engines":{"node":24}}').diagnostics[0]?.code).toBe(
      'INVALID_NODE_VERSION',
    );
  });
  it('detects invalid modes, blank overrides and contradictions', () => {
    expect(validateConfig({ lint: 'sometimes' }).map((d) => d.code)).toContain(
      'INVALID_CAPABILITY_MODE',
    );
    expect(
      validateConfig({ lint: 'false', 'lint-command': 'npm run lint:ci' }).map((d) => d.code),
    ).toContain('DISABLED_CAPABILITY_HAS_OVERRIDE');
    expect(
      validateConfig({ e2e: 'false', 'e2e-command': 'npm run e2e' }).map((d) => d.code),
    ).toContain('DISABLED_CAPABILITY_HAS_OVERRIDE');
    expect(validateConfig({ 'unit-command': '   ' }).map((d) => d.code)).toContain(
      'INVALID_COMMAND_OVERRIDE',
    );
  });
});

describe('package manager resolution', () => {
  it.each([
    [{ lockfiles: ['package-lock.json'] }, 'npm', 'lockfile'],
    [{ packageManager: 'npm@10.8.2', lockfiles: ['package-lock.json'] }, 'npm', 'package-json'],
    [{ packageManager: 'pnpm@9.15.4', lockfiles: ['pnpm-lock.yaml'] }, 'pnpm', 'package-json'],
    [{ packageManager: 'yarn@4.5.3', lockfiles: ['yarn.lock'] }, 'yarn', 'package-json'],
    [{ explicit: 'pnpm', lockfiles: ['package-lock.json', 'pnpm-lock.yaml'] }, 'pnpm', 'input'],
  ] as const)('resolves selected metadata evidence', (evidence, name, source) => {
    const result = resolvePackageManager(evidence);
    expect(result.ok && result.value).toMatchObject({ name, source });
  });
  it('prefers shrinkwrap and rejects ambiguous or conflicting evidence', () => {
    expect(
      resolvePackageManager({ lockfiles: ['package-lock.json', 'npm-shrinkwrap.json'] }),
    ).toMatchObject({ ok: true, value: { lockfile: 'npm-shrinkwrap.json' } });
    expect(resolvePackageManager({ lockfiles: [] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PACKAGE_MANAGER_NOT_FOUND' }],
    });
    expect(
      resolvePackageManager({ lockfiles: ['package-lock.json', 'pnpm-lock.yaml'] }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'MULTIPLE_LOCKFILES' }] });
    const conflict = resolvePackageManager({
      packageManager: 'npm@10.8.2',
      lockfiles: ['pnpm-lock.yaml'],
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok)
      expect(conflict.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'PACKAGE_MANAGER_LOCKFILE_CONFLICT',
      );
    expect(
      resolvePackageManager({ packageManager: 'bun@1.0.0', lockfiles: ['package-lock.json'] }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'UNSUPPORTED_PACKAGE_MANAGER' }] });
    expect(
      resolvePackageManager({ packageManager: 'pnpm@latest', lockfiles: ['pnpm-lock.yaml'] }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'UNSUPPORTED_PACKAGE_MANAGER_VERSION' }] });
    expect(
      resolvePackageManager({ packageManager: 'yarn@3.2.0', lockfiles: ['yarn.lock'] }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'UNSUPPORTED_PACKAGE_MANAGER_VERSION' }] });
  });
});

describe('Node selector resolution', () => {
  it('applies precedence and defaults to Node 24', () => {
    expect(resolveNodeVersion({ explicit: '26.1', nvmrc: '22' })).toMatchObject({
      ok: true,
      value: { selector: '26.1', source: 'input' },
      diagnostics: [{ severity: 'warning' }],
    });
    expect(
      resolveNodeVersion({ nvmrc: '22', nodeVersionFile: '22', enginesNode: '22' }),
    ).toMatchObject({ ok: true, value: { source: '.nvmrc' } });
    expect(resolveNodeVersion({ nodeVersionFile: '24' })).toMatchObject({
      ok: true,
      value: { source: '.node-version' },
    });
    expect(resolveNodeVersion({ enginesNode: '24' })).toMatchObject({
      ok: true,
      value: { source: 'engines.node' },
    });
    expect(resolveNodeVersion({})).toMatchObject({
      ok: true,
      value: { selector: '24', source: 'shared-default' },
    });
  });
  it('rejects conflicts, malformed values and ranges', () => {
    expect(resolveNodeVersion({ nvmrc: '22', nodeVersionFile: '24' })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'NODE_VERSION_CONFLICT' }],
    });
    expect(resolveNodeVersion({ nvmrc: '22', enginesNode: '>=22' })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'INVALID_NODE_VERSION' }],
    });
    expect(resolveNodeVersion({ explicit: 'lts/*' })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'INVALID_NODE_VERSION' }],
    });
  });
});

describe('capability discovery', () => {
  it.each(['lint', 'typecheck', 'unit', 'integration', 'build'] as const)(
    'handles all modes for %s',
    (name) => {
      const script =
        name === 'unit' ? 'test:unit' : name === 'integration' ? 'test:integration' : name;
      expect(resolveCapabilities({ [name]: 'auto' }, { scripts })).toMatchObject({
        ok: true,
        value: { [name]: { state: 'DETECTED', command: { value: script } } },
      });
      expect(resolveCapabilities({ [name]: 'auto' }, { scripts: {} })).toMatchObject({
        ok: true,
        value: { [name]: { state: 'ABSENT' } },
      });
      expect(resolveCapabilities({ [name]: 'true' }, { scripts })).toMatchObject({
        ok: true,
        value: { [name]: { state: 'DETECTED' } },
      });
      expect(resolveCapabilities({ [name]: 'true' }, { scripts: {} })).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'REQUIRED_CAPABILITY_MISSING' }],
      });
      expect(resolveCapabilities({ [name]: 'false' }, { scripts })).toMatchObject({
        ok: true,
        value: { [name]: { state: 'DISABLED' } },
      });
      expect(
        resolveCapabilities({ [`${name}-command`]: '  npm run custom  ' }, { scripts: {} }),
      ).toMatchObject({
        ok: true,
        value: {
          [name]: { state: 'OVERRIDDEN', command: { kind: 'opaque', value: '  npm run custom  ' } },
        },
      });
    },
  );
  it('uses test as unit-only fallback and prefers test:unit', () => {
    expect(resolveCapabilities({}, { scripts: { test: 'generic' } })).toMatchObject({
      ok: true,
      value: { unit: { command: { value: 'test' } }, integration: { state: 'ABSENT' } },
    });
    expect(
      resolveCapabilities({}, { scripts: { test: 'generic', 'test:unit': 'specific' } }),
    ).toMatchObject({ ok: true, value: { unit: { command: { value: 'test:unit' } } } });
  });
  it('keeps e2e opt-in and requires a command when enabled', () => {
    expect(resolveCapabilities({}, { scripts })).toMatchObject({
      ok: true,
      value: { e2e: { state: 'DISABLED' } },
    });
    expect(resolveCapabilities({ e2e: 'true' }, { scripts })).toMatchObject({
      ok: true,
      value: { e2e: { state: 'DETECTED', command: { value: 'test:e2e' } } },
    });
    expect(
      resolveCapabilities({ e2e: 'true', 'e2e-command': 'playwright test' }, { scripts: {} }),
    ).toMatchObject({ ok: true, value: { e2e: { state: 'OVERRIDDEN' } } });
    expect(resolveCapabilities({ e2e: 'true' }, { scripts: {} })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'REQUIRED_CAPABILITY_MISSING' }],
    });
  });
});

describe('filesystem inspection and plan composition', () => {
  it('discovers npm, pnpm and yarn fixtures plus invalid project evidence', async () => {
    expect(await inspectProject(`${fixtureRoot}/npm-minimal`)).toMatchObject({
      ok: true,
      value: { packageManager: { name: 'npm' }, capabilities: { unit: { state: 'DETECTED' } } },
    });
    expect(await inspectProject(`${fixtureRoot}/pnpm`)).toMatchObject({
      ok: true,
      value: { packageManager: { name: 'pnpm', version: '9.15.4' } },
    });
    expect(await inspectProject(`${fixtureRoot}/yarn`)).toMatchObject({
      ok: true,
      value: { packageManager: { name: 'yarn', version: '4.5.3' } },
    });
    expect(await inspectProject(`${fixtureRoot}/conflicting-lockfiles`)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MULTIPLE_LOCKFILES' }],
    });
    expect(await inspectProject(`${fixtureRoot}/invalid-package-json`)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'INVALID_PACKAGE_JSON' }],
    });
    expect(await inspectProject(`${fixtureRoot}/node-conflict`)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'NODE_VERSION_CONFLICT' }],
    });
  });
  it('resolves all six enabled capabilities from npm fixture', async () => {
    expect(
      await inspectProject(`${fixtureRoot}/npm-full`, {
        lint: 'true',
        typecheck: 'true',
        unit: 'true',
        integration: 'true',
        build: 'true',
        e2e: 'true',
      }),
    ).toMatchObject({
      ok: true,
      value: {
        capabilities: {
          lint: { state: 'DETECTED' },
          typecheck: { state: 'DETECTED' },
          unit: { command: { value: 'test:unit' } },
          integration: { state: 'DETECTED' },
          build: { state: 'DETECTED' },
          e2e: { state: 'DETECTED' },
        },
      },
    });
  });
  it('does not mutate package metadata or create files', async () => {
    const dir = `${fixtureRoot}/npm-minimal`;
    const pkg = await readFile(`${dir}/package.json`, 'utf8');
    const lock = await readFile(`${dir}/package-lock.json`, 'utf8');
    const before = (await readdir(dir)).sort();
    await inspectProject(dir);
    expect(await readFile(`${dir}/package.json`, 'utf8')).toBe(pkg);
    expect(await readFile(`${dir}/package-lock.json`, 'utf8')).toBe(lock);
    expect((await readdir(dir)).sort()).toEqual(before);
  });
  it('reports missing directories/manifests and prevents escaping project root', async () => {
    expect(await inspectProject(`${fixtureRoot}/does-not-exist`)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PROJECT_DIRECTORY_NOT_FOUND' }],
    });
    expect(await inspectProject(fixtureRoot, { 'working-directory': '../' })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'INVALID_WORKING_DIRECTORY' }],
    });
    expect(
      await inspectProject(fixtureRoot, { 'working-directory': 'empty-project' }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PACKAGE_JSON_NOT_FOUND' }],
    });
  });
  it('composes already-read evidence into a machine-readable plan', () => {
    expect(
      resolveCiPlan(
        {},
        {
          workingDirectory: 'fixture',
          manifest: { scripts: { test: 'vitest' } },
          node: {},
          lockfiles: ['package-lock.json'],
        },
      ),
    ).toMatchObject({
      ok: true,
      value: {
        node: { selector: '24' },
        packageManager: { name: 'npm' },
        capabilities: {
          unit: { state: 'DETECTED', command: { value: 'test' } },
          e2e: { state: 'DISABLED' },
        },
      },
    });
  });
});
