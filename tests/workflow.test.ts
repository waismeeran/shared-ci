import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readActionInputs, toCiConfig } from '../src/workflow/inputs.js';
import { validateConfig } from '../src/config/validation.js';

const workflowPath = new URL('../.github/workflows/node-ci.yml', import.meta.url);

describe('workflow input adapter', () => {
  it('translates every contract default', () => {
    expect(toCiConfig({})).toEqual({
      'node-version': 'auto',
      'package-manager': 'auto',
      'working-directory': '.',
      lint: 'auto',
      typecheck: 'auto',
      unit: 'auto',
      integration: 'auto',
      build: 'auto',
      e2e: 'false',
      'lint-command': undefined,
      'typecheck-command': undefined,
      'unit-command': undefined,
      'integration-command': undefined,
      'build-command': undefined,
      'e2e-command': undefined,
    });
  });

  it('reads GitHub action input variables while preserving hyphens in input names', () => {
    expect(
      readActionInputs({
        'INPUT_NODE-VERSION': '24',
        'INPUT_PACKAGE-MANAGER': 'pnpm',
        'INPUT_WORKING-DIRECTORY': 'apps/site',
        'INPUT_LINT-COMMAND': 'pnpm lint:ci',
      }),
    ).toMatchObject({
      'node-version': '24',
      'package-manager': 'pnpm',
      'working-directory': 'apps/site',
      'lint-command': 'pnpm lint:ci',
    });
  });

  it('canonicalizes omitted and empty working-directory inputs to root while preserving explicit paths', () => {
    expect(toCiConfig({})['working-directory']).toBe('.');
    expect(toCiConfig({ 'working-directory': '' })['working-directory']).toBe('.');
    expect(toCiConfig({ 'working-directory': '.' })['working-directory']).toBe('.');
    expect(toCiConfig({ 'working-directory': 'app' })['working-directory']).toBe('app');
  });

  it('preserves explicit environment values, modes, and commands', () => {
    expect(
      toCiConfig({
        'node-version': '22.4',
        'package-manager': 'pnpm',
        'working-directory': 'packages/api',
        lint: 'true',
        typecheck: 'false',
        unit: 'auto',
        integration: 'true',
        build: 'false',
        e2e: 'true',
        'lint-command': 'pnpm lint:ci',
        'typecheck-command': '',
        'unit-command': 'pnpm test:ci',
        'integration-command': 'pnpm test:integration',
        'build-command': '',
        'e2e-command': 'pnpm e2e:ci',
      }),
    ).toEqual({
      'node-version': '22.4',
      'package-manager': 'pnpm',
      'working-directory': 'packages/api',
      lint: 'true',
      typecheck: 'false',
      unit: 'auto',
      integration: 'true',
      build: 'false',
      e2e: 'true',
      'lint-command': 'pnpm lint:ci',
      'typecheck-command': undefined,
      'unit-command': 'pnpm test:ci',
      'integration-command': 'pnpm test:integration',
      'build-command': undefined,
      'e2e-command': 'pnpm e2e:ci',
    });
  });

  it('leaves input validation to the existing config validator', () => {
    expect(validateConfig(toCiConfig({ lint: 'sometimes' })).map(({ code }) => code)).toContain(
      'INVALID_CAPABILITY_MODE',
    );
    expect(
      validateConfig(toCiConfig({ 'package-manager': 'bun' })).map(({ code }) => code),
    ).toContain('UNSUPPORTED_PACKAGE_MANAGER');
  });
});

describe('reusable workflow contract', () => {
  it('declares the frozen workflow_call inputs and fixed job policy', async () => {
    const yaml = await readFile(workflowPath, 'utf8');
    expect(yaml).toMatch(/^on:\n {2}workflow_call:/m);
    for (const name of [
      'node-version',
      'package-manager',
      'working-directory',
      'lint',
      'typecheck',
      'unit',
      'integration',
      'build',
      'e2e',
      'lint-command',
      'typecheck-command',
      'unit-command',
      'integration-command',
      'build-command',
      'e2e-command',
    ])
      expect(yaml).toMatch(new RegExp(`^ {6}${name}:\\n {8}type: string$`, 'm'));
    for (const [name, value] of Object.entries({
      'node-version': 'auto',
      'package-manager': 'auto',
      'working-directory': '.',
      lint: 'auto',
      typecheck: 'auto',
      unit: 'auto',
      integration: 'auto',
      build: 'auto',
      'lint-command': "''",
      'typecheck-command': "''",
      'unit-command': "''",
      'integration-command': "''",
      'build-command': "''",
      'e2e-command': "''",
    }))
      expect(yaml).toMatch(
        new RegExp(`^ {6}${name}:\\n {8}type: string\\n {8}default: ${value}$`, 'm'),
      );
    expect(yaml).toMatch(/^ {6}e2e:\n {8}type: string\n {8}default: 'false'$/m);
    expect(yaml).not.toMatch(/^ {6}timeout-minutes:/m);
    expect(yaml).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(yaml).toMatch(
      /^ {2}ci:\n {4}runs-on: ubuntu-latest\n {4}timeout-minutes: 60\n {4}permissions:\n {6}contents: read$/m,
    );
    expect(yaml).not.toMatch(/^ {4}secrets:/m);
    expect(yaml).not.toMatch(/secrets:\s*inherit/);
    expect(yaml).not.toMatch(/^\s+run:/m);
    expect(yaml).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
    expect(yaml).toMatch(/uses: actions\/setup-node@[0-9a-f]{40}/);
    expect(yaml).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    expect(yaml).toContain('actions/setup-node@820762786026740c76f36085b0efc47a31fe5020');
    expect(yaml).not.toMatch(/uses: [^\s]+@(main|master|v\d+)\b/);
    expect(yaml).toMatch(/uses: \$\/.github\/actions\/node-ci/);
    const prepareIndex = yaml.indexOf('name: Prepare package manager and resolve package cache');
    const restoreIndex = yaml.indexOf('name: Restore package-manager cache');
    const installIndex = yaml.indexOf('name: Immutable dependency installation');
    const saveIndex = yaml.indexOf('name: Save package-manager cache');
    const coreIndex = yaml.indexOf('name: Run capabilities');
    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(restoreIndex).toBeGreaterThan(prepareIndex);
    expect(installIndex).toBeGreaterThan(restoreIndex);
    expect(saveIndex).toBeGreaterThan(installIndex);
    expect(coreIndex).toBeGreaterThan(installIndex);
    expect(yaml.slice(restoreIndex, installIndex)).toContain(
      'uses: actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
    );
    expect(yaml.slice(saveIndex, coreIndex)).toContain(
      'uses: actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
    );
    expect(yaml).toMatch(
      /SHARED_CI_CACHE_RESTORE_OUTCOME: \$\{\{ steps\.pm_cache_restore\.outcome \}\}/,
    );
    expect(yaml).toMatch(/SHARED_CI_CACHE_SAVE_OUTCOME: \$\{\{ steps\.pm_cache_save\.outcome \}\}/);
    expect(yaml).not.toMatch(/actions\/cache[^\n]*node_modules/i);
    expect(yaml).not.toMatch(
      /secrets:\s*inherit|id-token:\s*write|contents:\s*write|packages:\s*write/,
    );
    expect(yaml.slice(coreIndex)).toContain('phase: capabilities');
    expect(yaml).not.toContain('phase: e2e');
    expect(yaml).not.toMatch(/playwright\s+install|cypress\s+install|start-server-and-test/i);
    expect(yaml).not.toMatch(/^\s+services:/m);
    expect(yaml).not.toMatch(/\b(deploy|deployment|upload-artifact)\b/i);
  });
});
