import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectProject } from '../src/index.js';
import type { Diagnostic } from '../src/index.js';
import {
  buildCiSummary,
  capabilityReportRows,
  renderCiSummaryMarkdown,
  renderDiagnosticAnnotation,
} from '../src/index.js';
import { writeGithubStepSummary } from '../src/reporting/github-summary.js';
import type { CiActionState, SetupReportState } from '../src/reporting/types.js';
import { readActionState, writeActionState } from '../scripts/action-state.js';

const fixture = resolve(import.meta.dirname, '../fixtures/npm-minimal');
const temporaryDirectories: string[] = [];

async function resolvedPlan(config: Parameters<typeof inspectProject>[1] = {}) {
  const result = await inspectProject(fixture, config);
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
  return result.value;
}

function setup(status: SetupReportState['status'] = 'PASSED'): SetupReportState {
  return {
    status,
    ...(status === 'PASSED'
      ? { currentStage: undefined }
      : { currentStage: 'dependency-installation' as const }),
    runtimeVerification: {
      status: 'PASSED',
      requirement: { runtime: 'node', selector: '24', source: 'shared-default' },
      actualVersion: 'v24.21.0',
    },
    preparation: {
      status: status === 'FAILED' ? 'PASSED' : status === 'TIMED_OUT' ? 'PASSED' : 'PASSED',
      stage: 'READY',
      packageManager: 'npm',
      actualVersion: '11.19.0',
      diagnostics: [],
    },
    installation: {
      status: status === 'FAILED' || status === 'TIMED_OUT' ? status : 'PASSED',
      packageManager: 'npm',
      lockfile: 'package-lock.json',
      exitCode: status === 'FAILED' ? 1 : 0,
    },
    diagnostics:
      status === 'FAILED'
        ? [{ code: 'DEPENDENCY_INSTALLATION_FAILED', severity: 'error', message: 'npm ci failed.' }]
        : [],
  };
}

function state(overrides: Partial<CiActionState> = {}): CiActionState {
  return {
    version: 1,
    preflightStatus: 'PASSED',
    projectDirectory: '.',
    diagnostics: [],
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('summary model and Markdown renderer', () => {
  it('renders a complete successful summary with all six distinct capability rows', async () => {
    const plan = await resolvedPlan({ 'node-version': '24' });
    const rows = capabilityReportRows(plan).map((row) => ({
      ...row,
      executionStatus:
        row.discoveryState === 'ABSENT' || row.discoveryState === 'DISABLED'
          ? ('SKIPPED' as const)
          : ('PASSED' as const),
      ...(row.discoveryState === 'ABSENT' ? { skipReason: 'ABSENT' as const } : {}),
      ...(row.discoveryState === 'DISABLED' ? { skipReason: 'DISABLED' as const } : {}),
    }));
    const summary = buildCiSummary(
      state({
        plan,
        nodeSetupStatus: 'PASSED',
        setup: setup(),
        capabilities: rows,
        aggregate: 'PASSED',
      }),
    );
    const markdown = renderCiSummaryMarkdown(summary);
    expect(summary.result).toBe('PASS');
    expect(markdown).toContain('## Environment / project');
    expect(markdown).toContain('## Setup / installation');
    expect(markdown).toContain('## Capabilities');
    expect(markdown).toContain('## Diagnostics');
    expect(summary.capabilities.map(({ capability }) => capability)).toEqual([
      'lint',
      'typecheck',
      'unit',
      'integration',
      'build',
      'e2e',
    ]);
    expect(markdown).toContain('| ABSENT |');
    expect(markdown).toContain('| DISABLED |');
    expect(markdown).toContain('| SKIPPED |');
  });

  it('renders actionable typed preflight failures without inventing later results', () => {
    const diagnostic: Diagnostic = {
      code: 'PACKAGE_MANAGER_LOCKFILE_CONFLICT',
      severity: 'error',
      message: 'packageManager declares pnpm but package-lock.json was detected.',
      source: 'package.json packageManager',
      remediation: 'Keep only the lockfile matching the declared package manager.',
    };
    const summary = buildCiSummary(
      state({
        preflightStatus: 'FAILED',
        diagnostics: [diagnostic],
        projectDirectory: 'apps/site',
      }),
    );
    const markdown = renderCiSummaryMarkdown(summary);
    expect(summary.result).toBe('FAIL');
    expect(markdown).toContain('PACKAGE_MANAGER_LOCKFILE_CONFLICT');
    expect(markdown).toContain('Keep only the lockfile matching');
    expect(markdown).toContain('NOT_RESOLVED');
    expect(markdown).toContain('NOT_EXECUTED');
    expect(markdown).toContain('NOT_REACHED');
    expect(markdown).not.toMatch(/\| unit \| ABSENT \|.*PASSED/);
  });

  it('includes required capability diagnostics and keeps warnings visible on success', async () => {
    const missing: Diagnostic = {
      code: 'REQUIRED_CAPABILITY_MISSING',
      severity: 'error',
      message: 'Capability "unit" is required but no command was found.',
      source: 'unit',
    };
    const failed = renderCiSummaryMarkdown(
      buildCiSummary(
        state({
          preflightStatus: 'FAILED',
          diagnostics: [missing],
        }),
      ),
    );
    expect(failed).toContain('REQUIRED_CAPABILITY_MISSING');

    const resolution = await inspectProject(
      resolve(import.meta.dirname, '../fixtures/node-conflict'),
      {
        'node-version': '22',
      },
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error('Expected explicit Node selection to resolve.');
    const plan = resolution.value;
    const warning = plan.diagnostics.find(({ code }) => code === 'NODE_VERSION_OVERRIDE');
    expect(warning).toBeDefined();
    if (!warning) throw new Error('Expected node selector override warning');
    const success = buildCiSummary(
      state({
        plan,
        diagnostics: [warning],
        nodeSetupStatus: 'PASSED',
        setup: setup(),
        capabilities: capabilityReportRows(plan),
        aggregate: 'PASSED',
      }),
    );
    expect(success.result).toBe('PASS');
    expect(renderCiSummaryMarkdown(success)).toContain('WARNING — NODE_VERSION_OVERRIDE');
  });

  it('reports install failure separately and leaves capabilities not executed', async () => {
    const plan = await resolvedPlan();
    const summary = buildCiSummary(
      state({
        plan,
        setup: setup('FAILED'),
      }),
    );
    const markdown = renderCiSummaryMarkdown(summary);
    expect(summary.result).toBe('FAIL');
    expect(markdown).toContain('| Immutable installation | FAILED |');
    expect(markdown).toContain('| unit |');
    expect(markdown).toContain('| NOT_EXECUTED |');
    expect(markdown).not.toContain('| unit | ABSENT |');
  });

  it('reports package-cache hits, misses, unavailable saves, and stages not reached', async () => {
    const plan = await resolvedPlan();
    const hit = buildCiSummary(
      state({
        plan,
        packageCache: {
          status: 'HIT',
          manager: 'npm',
          managerVersion: '11.19.0',
          keyIdentity: 'abc123def456',
          saveStatus: 'NOT_NEEDED',
        },
      }),
    );
    const markdown = renderCiSummaryMarkdown(hit);
    expect(markdown).toContain('## Package-manager cache');
    expect(markdown).toContain('HIT; save NOT_NEEDED');
    expect(markdown).toContain('abc123def456');
    expect(markdown).not.toContain('/Users/');
    expect(
      renderCiSummaryMarkdown(
        buildCiSummary(
          state({ preflightStatus: 'FAILED', packageCache: { status: 'NOT_REACHED' } }),
        ),
      ),
    ).toContain('| NOT_REACHED |');
  });

  it('maps cache restore/save outcomes truthfully without affecting install correctness', async () => {
    const { applyCacheRestoreOutcome, applyCacheSaveOutcome } =
      await import('../src/reporting/package-cache-state.js');
    const planned = {
      status: 'NOT_ATTEMPTED' as const,
      manager: 'pnpm' as const,
      keyIdentity: 'abcd',
    };
    expect(applyCacheRestoreOutcome(planned, 'success', 'true').state.status).toBe('HIT');
    expect(applyCacheRestoreOutcome(planned, 'success', 'false').state.status).toBe('MISS');
    expect(applyCacheRestoreOutcome(planned, 'success', '').state.status).toBe('MISS');
    expect(applyCacheRestoreOutcome(planned, 'failure', undefined)).toMatchObject({
      state: { status: 'UNAVAILABLE' },
      warning: { severity: 'warning', code: 'PACKAGE_CACHE_RESTORE_UNAVAILABLE' },
    });
    expect(
      applyCacheRestoreOutcome({ status: 'NOT_REACHED' }, 'skipped', undefined).state.status,
    ).toBe('NOT_REACHED');
    expect(applyCacheSaveOutcome({ status: 'MISS' }, 'success').state.saveStatus).toBe('SAVED');
    expect(applyCacheSaveOutcome({ status: 'MISS' }, 'failure')).toMatchObject({
      state: { status: 'MISS', saveStatus: 'UNAVAILABLE' },
      warning: { severity: 'warning', code: 'PACKAGE_CACHE_SAVE_UNAVAILABLE' },
    });
    expect(applyCacheSaveOutcome({ status: 'HIT' }, 'skipped').state.saveStatus).toBe('NOT_NEEDED');
  });

  it('reports pinned setup-node failure without implying install or capabilities ran', async () => {
    const plan = await resolvedPlan();
    const summary = buildCiSummary(state({ plan, nodeSetupStatus: 'FAILED' }));
    const markdown = renderCiSummaryMarkdown(summary);
    expect(summary.result).toBe('FAIL');
    expect(markdown).toContain('| actions/setup-node | FAILED |');
    expect(markdown).toContain('| Immutable installation | NOT_REACHED |');
    expect(markdown).toContain('NOT_EXECUTED');
  });

  it('reports package-manager preparation failure before immutable install', async () => {
    const plan = await resolvedPlan();
    const report: SetupReportState = {
      status: 'FAILED',
      failedAt: 'package-manager-preparation',
      runtimeVerification: {
        status: 'PASSED',
        requirement: { runtime: 'node', selector: '24', source: 'shared-default' },
        actualVersion: 'v24.21.0',
      },
      preparation: {
        status: 'FAILED',
        stage: 'NPM_AVAILABILITY',
        packageManager: 'npm',
        diagnostics: [
          { code: 'PACKAGE_MANAGER_UNAVAILABLE', severity: 'error', message: 'npm missing' },
        ],
      },
      diagnostics: [
        { code: 'PACKAGE_MANAGER_UNAVAILABLE', severity: 'error', message: 'npm missing' },
      ],
    };
    const markdown = renderCiSummaryMarkdown(buildCiSummary(state({ plan, setup: report })));
    expect(markdown).toContain('| Package-manager preparation | FAILED |');
    expect(markdown).toContain('| Immutable installation | NOT_REACHED |');
    expect(markdown).toContain('PACKAGE_MANAGER_UNAVAILABLE');
  });

  it('labels interruption during installation incomplete with later capabilities not reached', async () => {
    const plan = await resolvedPlan();
    const summary = buildCiSummary(
      state({
        plan,
        setup: {
          status: 'IN_PROGRESS',
          currentStage: 'dependency-installation',
          runtimeVerification: {
            status: 'PASSED',
            requirement: { runtime: 'node', selector: '24', source: 'shared-default' },
            actualVersion: 'v24.21.0',
          },
          diagnostics: [],
        },
      }),
    );
    const markdown = renderCiSummaryMarkdown(summary);
    expect(summary.result).toBe('INCOMPLETE');
    expect(markdown).toContain('| Immutable installation | IN_PROGRESS | In progress |');
    expect(markdown).toContain('NOT_EXECUTED');
  });

  it('preserves capability failures, prerequisite skips, E2E failures, and timeouts', async () => {
    const plan = await resolvedPlan();
    const initial = capabilityReportRows(plan);
    const set = (name: string, patch: Partial<(typeof initial)[number]>) =>
      initial.map((row) => (row.capability === name ? { ...row, ...patch } : row));
    const failed = set('lint', { executionStatus: 'FAILED' })
      .map((row) =>
        row.capability === 'typecheck' ? { ...row, executionStatus: 'PASSED' as const } : row,
      )
      .map((row) =>
        row.capability === 'unit' ? { ...row, executionStatus: 'FAILED' as const } : row,
      )
      .map((row) =>
        row.capability === 'integration'
          ? {
              ...row,
              discoveryState: 'ABSENT' as const,
              executionStatus: 'SKIPPED' as const,
              skipReason: 'ABSENT' as const,
            }
          : row,
      )
      .map((row) =>
        row.capability === 'build'
          ? {
              ...row,
              executionStatus: 'SKIPPED' as const,
              skipReason: 'PREREQUISITE_FAILED' as const,
            }
          : row,
      )
      .map((row) =>
        row.capability === 'e2e'
          ? {
              ...row,
              discoveryState: 'DISABLED' as const,
              executionStatus: 'SKIPPED' as const,
              skipReason: 'DISABLED' as const,
            }
          : row,
      );
    const markdown = renderCiSummaryMarkdown(
      buildCiSummary(
        state({
          plan,
          setup: setup(),
          capabilities: failed,
          aggregate: 'FAILED',
        }),
      ),
    );
    expect(markdown).toContain('| lint |');
    expect(markdown).toContain('| FAILED |');
    expect(markdown).toContain('PREREQUISITE_FAILED');
    expect(markdown).toContain('| integration | ABSENT |');

    const timed = initial.map((row) =>
      row.capability === 'e2e' ? { ...row, executionStatus: 'TIMED_OUT' as const } : row,
    );
    const timeoutMarkdown = renderCiSummaryMarkdown(
      buildCiSummary(
        state({
          plan,
          setup: setup(),
          capabilities: timed,
          aggregate: 'FAILED',
        }),
      ),
    );
    expect(timeoutMarkdown).toContain('| e2e |');
    expect(timeoutMarkdown).toContain('| TIMED_OUT |');

    const e2eFailed = initial.map((row) =>
      row.capability === 'e2e'
        ? { ...row, discoveryState: 'OVERRIDDEN' as const, executionStatus: 'FAILED' as const }
        : { ...row, executionStatus: 'PASSED' as const },
    );
    const e2eMarkdown = renderCiSummaryMarkdown(
      buildCiSummary(
        state({
          plan,
          setup: setup(),
          capabilities: e2eFailed,
          aggregate: 'FAILED',
        }),
      ),
    );
    expect(e2eMarkdown).toMatch(/\| e2e \| OVERRIDDEN \|.*\| FAILED \|/);
  });

  it('escapes table delimiters and multiline diagnostic content and renders deterministically', async () => {
    const plan = await resolvedPlan({
      e2e: 'true',
      'e2e-command': 'npm run e2e | `browser` <script>\n--flag',
    });
    const diagnostic: Diagnostic = {
      code: 'CUSTOM<CODE>',
      severity: 'warning',
      message: 'pipe | and `tick` <tag>\nnext line',
    };
    const summary = buildCiSummary(state({ plan, diagnostics: [diagnostic] }));
    const first = renderCiSummaryMarkdown(summary);
    expect(first).toContain('&#124;');
    expect(first).toContain('&lt;script&gt;');
    expect(first).toContain('<br>');
    expect(first).toContain('next line');
    expect(renderCiSummaryMarkdown(summary)).toBe(first);
    expect(first).not.toContain('process.env');
    expect(first).not.toContain('PATH=');
  });
});

describe('GitHub reporting adapters', () => {
  it('writes rendered Markdown when a summary destination is provided and reports local unavailability', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shared-ci-summary-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'step-summary.md');
    const summary = buildCiSummary(state({ preflightStatus: 'FAILED' }));
    expect(await writeGithubStepSummary(summary, undefined)).toBe('UNAVAILABLE');
    expect(await writeGithubStepSummary(summary, path)).toBe('WRITTEN');
    expect(await readFile(path, 'utf8')).toContain('# Shared CI');
  });

  it('atomically round-trips valid action state and rejects malformed state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shared-ci-state-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'state.json');
    const value = state({
      preflightStatus: 'FAILED',
      diagnostics: [
        {
          code: 'TEST',
          severity: 'error',
          message: 'expected failure',
        },
      ],
    });
    await writeActionState(path, value);
    expect(await readActionState(path)).toEqual(value);
    await readFile(path, 'utf8').then((text) => expect(JSON.parse(text)).toEqual(value));
    await writeFile(path, '{"version":99}');
    await expect(readActionState(path)).rejects.toThrow('unsupported shape');
  });

  it('escapes annotation control characters', () => {
    expect(
      renderDiagnosticAnnotation({
        code: 'BAD:INPUT',
        severity: 'error',
        source: 'a,b',
        message: 'line one\nline two %',
      }),
    ).toBe('::error title=BAD%3AINPUT::a%2Cb: line one%0Aline two %25');
  });

  it('keeps a final always-run local action finalizer and immutable action references', async () => {
    const yaml = await readFile(
      new URL('../.github/workflows/node-ci.yml', import.meta.url),
      'utf8',
    );
    const finalizer = yaml.indexOf('name: Write Shared CI summary');
    expect(finalizer).toBeGreaterThan(yaml.indexOf('name: Run capabilities'));
    expect(yaml.slice(finalizer)).toMatch(/if: \$\{\{ always\(\) \}\}/);
    expect(yaml.slice(finalizer)).toContain('uses: $/.github/actions/node-ci');
    expect(yaml.slice(finalizer)).toContain('phase: finalize');
    expect(yaml.slice(finalizer)).toContain(
      'SHARED_CI_SETUP_NODE_OUTCOME: ${{ steps.setup_node.outcome }}',
    );
    expect(yaml.slice(finalizer)).toContain('continue-on-error: true');
    expect(yaml).toMatch(/jobs:\n {2}ci:/);
    expect(yaml).not.toMatch(/uses: [^\s]+@(main|master|v\d+)\b/);
  });
});
