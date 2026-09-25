import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function publicInputs(): Set<string> {
  const workflow = readFileSync(path.join(root, '.github/workflows/node-ci.yml'), 'utf8');
  const section = workflow.match(
    /workflow_call:\s*\n\s+inputs:\s*\n([\s\S]*?)\n\s*permissions:/,
  )?.[1];
  if (!section) throw new Error('Could not locate workflow_call.inputs');
  return new Set([...section.matchAll(/^\s{6}([\w-]+):\s*$/gm)].map((match) => match[1]!));
}

describe('Milestone 8 repository contracts', () => {
  it('keeps every example with-key in the shipped reusable workflow input contract', () => {
    const allowed = publicInputs();
    const reference = readFileSync(path.join(root, 'docs/consumer-contract.md'), 'utf8');
    expect(reference).not.toMatch(/\|\s*timeout(?:-minutes)?\s*\|/i);
    for (const input of allowed)
      expect(reference, `contract reference missing ${input}`).toContain(`\`${input}\``);
    const examples = [
      ...walk(path.join(root, 'examples')).filter((file) => file.endsWith('.yml')),
      path.join(root, 'fixtures/hosted-validation/caller.yml'),
    ];
    expect(examples.length).toBeGreaterThanOrEqual(5);
    for (const file of examples) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      let inWith = false;
      let withIndent = 0;
      for (const line of lines) {
        const indent = line.length - line.trimStart().length;
        if (/^\s*with:\s*(?:#.*)?$/.test(line)) {
          inWith = true;
          withIndent = indent;
          continue;
        }
        if (inWith && line.trim() && !line.trimStart().startsWith('#') && indent <= withIndent)
          inWith = false;
        if (inWith) {
          const match = line.match(/^\s+([\w-]+):/);
          if (match)
            expect(
              allowed.has(match[1]!),
              `${path.relative(root, file)} uses unknown input ${match[1]}`,
            ).toBe(true);
        }
      }
    }
  });

  it('defines the deliberate hosted integration matrix using valid workflow inputs and fixture roots', () => {
    const manifestPath = path.join(root, 'fixtures/hosted-validation/cases.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      workflow: string;
      cacheValidation: {
        cycles: Array<{ manager: string; caseId: string; expected: string[] }>;
        lockfileInvalidation: { beforeCaseId: string; afterCaseId: string; expected: string[] };
      };
      cases: Array<{
        id: string;
        fixture: string;
        manager: string;
        inputs: Record<string, string>;
        expectedConclusion: string;
        expectedValidation?: string;
        capabilities: Record<string, string>;
        summary: string;
      }>;
    };
    expect(manifest.workflow).toBe('.github/workflows/node-ci.yml');
    expect(manifest.cases.map((item) => item.id)).toEqual([
      'npm-conventional',
      'npm-node22',
      'npm-node26',
      'pnpm-conventional',
      'yarn4-conventional',
      'custom-overrides',
      'nested-working-directory',
      'e2e-enabled',
      'invalid-config',
      'capability-failure',
      'npm-cache-invalidation-before',
      'npm-cache-invalidation-after',
    ]);
    const allowed = publicInputs();
    for (const item of manifest.cases) {
      const fixtureRoot = path.join(root, item.fixture);
      expect(statSync(fixtureRoot).isDirectory(), item.fixture).toBe(true);
      expect(statSync(path.join(fixtureRoot, 'package.json')).isFile(), item.fixture).toBe(true);
      for (const input of Object.keys(item.inputs))
        expect(allowed.has(input), `${item.id}: ${input}`).toBe(true);
      expect(['success', 'failure']).toContain(item.expectedConclusion);
      if (item.expectedConclusion === 'failure') expect(item.expectedValidation).toBe('PASS');
      expect(item.manager).toMatch(/^(npm|pnpm|yarn)$/);
      expect(Object.keys(item.capabilities)).not.toHaveLength(0);
      expect(item.summary.length).toBeGreaterThan(0);
    }
    expect(manifest.cacheValidation.cycles).toHaveLength(4);
    for (const cycle of manifest.cacheValidation.cycles) {
      expect(cycle.expected).toEqual(['MISS', 'HIT']);
      expect(manifest.cases.some((item) => item.id === cycle.caseId)).toBe(true);
      const cacheCase = manifest.cases.find((item) => item.id === cycle.caseId)!;
      const packageJson = JSON.parse(
        readFileSync(path.join(root, cacheCase.fixture, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      expect(
        Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }),
        `${cycle.caseId} must contain a package so hosted cache paths contain cache data`,
      ).not.toHaveLength(0);
    }
    expect(manifest.cacheValidation.lockfileInvalidation).toMatchObject({
      beforeCaseId: 'npm-cache-invalidation-before',
      afterCaseId: 'npm-cache-invalidation-after',
      expected: ['MISS', 'MISS'],
    });
    for (const caseId of [
      manifest.cacheValidation.lockfileInvalidation.beforeCaseId,
      manifest.cacheValidation.lockfileInvalidation.afterCaseId,
    ]) {
      const cacheCase = manifest.cases.find((item) => item.id === caseId)!;
      const packageJson = JSON.parse(
        readFileSync(path.join(root, cacheCase.fixture, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      expect(
        Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }),
      ).not.toHaveLength(0);
    }
    const caller = readFileSync(path.join(root, 'fixtures/hosted-validation/caller.yml'), 'utf8');
    for (const item of manifest.cases) expect(caller).toContain(`- ${item.id}`);
    expect(caller).toMatch(/working-directory: \$\{\{ inputs\.working_directory \}\}/);
    expect(caller).toMatch(/node-version: \$\{\{ inputs\.node_version \}\}/);
    expect(caller).not.toMatch(/^\s{6}working_directory: \$\{\{ inputs\./m);
  });

  it('resolves all local Markdown links in user-facing repository docs', () => {
    const markdown = [
      path.join(root, 'README.md'),
      path.join(root, 'CONTRIBUTING.md'),
      path.join(root, 'SECURITY.md'),
      ...walk(path.join(root, 'docs')).filter((file) => file.endsWith('.md')),
      ...walk(path.join(root, 'examples')).filter((file) => file.endsWith('.md')),
    ];
    for (const file of markdown) {
      const content = readFileSync(file, 'utf8');
      for (const [, destination] of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        if (/^(?:https?:|mailto:|#)/.test(destination)) continue;
        const local = decodeURIComponent(destination.split('#')[0]!);
        if (!local) continue;
        expect(
          () => statSync(path.resolve(path.dirname(file), local)),
          `${path.relative(root, file)} -> ${destination}`,
        ).not.toThrow();
      }
    }
  });

  it('records actual source diagnostic identifiers in the troubleshooting reference', () => {
    const guide = readFileSync(path.join(root, 'docs/troubleshooting.md'), 'utf8');
    const source = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))]
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const codes = [...guide.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1]!);
    for (const code of codes) expect(source, `${code} absent from source`).toContain(`'${code}'`);
  });
});
