import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createSetupPlan,
  executeCommand,
  inspectProject,
  installDependencies,
  managerVersionForCache,
  preparePackageManager,
  resolvePackageManagerCachePath,
  resolvePackageManagerCachePlan,
  runCapabilities,
  verifyCorepackRuntime,
  verifyNodeRuntime,
} from '../src/index.js';
import {
  capabilityReportRows,
  buildCiSummary,
  appendCacheWarning,
  applyCacheRestoreOutcome,
  applyCacheSaveOutcome,
  renderDiagnosticAnnotation,
  renderCiSummaryMarkdown,
} from '../src/index.js';
import { toCiConfig } from '../src/workflow/inputs.js';
import type { Diagnostic, ResolvedCiPlan } from '../src/config/types.js';
import type { SetupPlan } from '../src/setup/types.js';
import type { SetupReportState, CiActionState } from '../src/reporting/types.js';
import { createCiActionState } from '../src/reporting/summary-model.js';
import { writeGithubStepSummary } from '../src/reporting/github-summary.js';
import { readActionState, writeActionState } from './action-state.js';

const inputNames = [
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
] as const;
const runnerTemp = process.env.RUNNER_TEMP ?? tmpdir();
const planPath = join(runnerTemp, 'shared-ci-plan.json');
const statePath = join(runnerTemp, 'shared-ci-action-state.json');
const preparedEnvironmentPath = join(runnerTemp, 'shared-ci-prepared-environment.json');
const setupPlanPath = join(runnerTemp, 'shared-ci-setup-plan.json');

async function main(): Promise<void> {
  const phase = process.env.INPUT_PHASE;
  try {
    if (phase === 'preflight') return await preflight();
    if (phase === 'prepare') return await prepare();
    if (phase === 'install') return await install();
    if (phase === 'capabilities') return await runAllCapabilities();
    if (phase === 'finalize') return await finalize();
    throw new Error(`Unknown Shared CI action phase "${phase ?? ''}".`);
  } catch (error) {
    await recordUnhandledFailure(phase, error);
    throw error;
  }
}

async function preflight(): Promise<void> {
  const inputs = Object.fromEntries(
    inputNames.map((name) => [
      name,
      process.env[`INPUT_${name.toUpperCase().replaceAll('-', '_')}`] ?? '',
    ]),
  );
  const config = toCiConfig(inputs);
  const workspace = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
  const resolution = await inspectProject(workspace, config);
  const state: CiActionState = {
    version: 1,
    preflightStatus: resolution.ok ? 'PASSED' : 'FAILED',
    projectDirectory: config['working-directory'] ?? '.',
    ...(resolution.ok ? { plan: resolution.value } : {}),
    diagnostics: resolution.diagnostics,
  };
  await writeActionState(statePath, state);
  if (!resolution.ok) {
    logDiagnostics(resolution.diagnostics);
    throw new Error('Shared CI preflight failed; correct the configuration diagnostics above.');
  }
  await writeFile(planPath, JSON.stringify(resolution.value), { mode: 0o600 });
  const output = process.env.GITHUB_OUTPUT;
  if (!output)
    throw new Error(
      'GITHUB_OUTPUT is unavailable; cannot pass the resolved Node selector to setup-node.',
    );
  await appendFile(output, `node-version=${resolution.value.node.selector}\n`);
  console.log(`Resolved Node: ${resolution.value.node.selector}`);
  console.log(
    `Package manager: ${resolution.value.packageManager.name}${resolution.value.packageManager.version ? `@${resolution.value.packageManager.version}` : ''}`,
  );
  console.log(`Working directory: ${resolution.value.project.workingDirectory}`);
}

async function prepare(): Promise<void> {
  const state = await readActionState(statePath);
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as ResolvedCiPlan;
  const workspace = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
  await saveSetup(state, {
    status: 'IN_PROGRESS',
    currentStage: 'runtime-verification',
    diagnostics: [],
  });
  // A JavaScript action's node24 runtime is independent of setup-node's PATH selection.
  const actualNode = await executeCommand({
    command: 'node --version',
    cwd: workspace,
    timeoutMs: 10_000,
    env: process.env,
  });
  if (actualNode.status !== 'PASSED') {
    const diagnostic: Diagnostic = {
      code: 'NODE_RUNTIME_VERIFICATION_FAILED',
      severity: 'error',
      message: 'Could not read the Node runtime selected on PATH; see the setup step log.',
    };
    await saveSetup(state, {
      status: actualNode.status === 'TIMED_OUT' ? 'TIMED_OUT' : 'FAILED',
      failedAt: 'runtime-verification',
      diagnostics: [diagnostic],
    });
    throw new Error(diagnostic.message);
  }
  const runtime = verifyNodeRuntime(
    { runtime: 'node', selector: plan.node.selector, source: plan.node.source },
    actualNode.stdout.trim(),
  );
  if (runtime.status !== 'PASSED') {
    await saveSetup(state, {
      status: 'FAILED',
      failedAt: 'runtime-verification',
      runtimeVerification: runtime,
      diagnostics: runtime.diagnostic ? [runtime.diagnostic] : [],
    });
    throw new Error(runtime.diagnostic?.message ?? 'Resolved Node runtime verification failed.');
  }
  console.log(`Verified selected Node runtime: ${runtime.actualVersion}`);
  await saveSetup(state, {
    status: 'IN_PROGRESS',
    currentStage: 'package-manager-preparation',
    runtimeVerification: runtime,
    diagnostics: [],
  });
  if (plan.packageManager.name !== 'npm') {
    const corepack = verifyCorepackRuntime(runtime.actualVersion);
    if (corepack) {
      await saveSetup(state, {
        status: 'FAILED',
        failedAt: 'package-manager-preparation',
        runtimeVerification: runtime,
        preparation: {
          status: 'FAILED',
          stage: 'COREPACK_INSTALLATION',
          packageManager: plan.packageManager.name,
          expectedVersion: plan.packageManager.version,
          diagnostics: [corepack],
        },
        diagnostics: [corepack],
      });
      throw new Error(corepack.message);
    }
  }
  const setup = await createSetupPlan(plan, {
    projectRoot: workspace,
    toolingDirectory: join(runnerTemp, 'shared-ci-tooling'),
  });
  if (!setup.ok) {
    await saveSetup(state, {
      status: 'FAILED',
      failedAt: 'package-manager-preparation',
      runtimeVerification: runtime,
      preparation: {
        status: 'FAILED',
        stage: 'SETUP_PLAN',
        packageManager: plan.packageManager.name,
        expectedVersion: plan.packageManager.version,
        diagnostics: setup.diagnostics,
      },
      diagnostics: setup.diagnostics,
    });
    throwDiagnostics(setup.diagnostics);
  }
  const preparation = await preparePackageManager(setup.value, { env: process.env });
  if (preparation.status !== 'PASSED') {
    logLines(preparation.commandResult?.stdout);
    logLines(preparation.commandResult?.stderr);
    const prep = {
      status: preparation.status,
      stage: preparation.stage,
      packageManager: preparation.packageManager,
      expectedVersion: preparation.expectedVersion,
      actualVersion: preparation.actualVersion,
      diagnostics: preparation.diagnostics,
    } as const;
    await saveSetup(state, {
      status: preparation.status,
      failedAt: 'package-manager-preparation',
      runtimeVerification: runtime,
      preparation: prep,
      diagnostics: preparation.diagnostics,
    });
    throwDiagnostics(preparation.diagnostics);
  }
  const preparationReport = {
    status: preparation.status,
    stage: preparation.stage,
    packageManager: preparation.packageManager,
    expectedVersion: preparation.expectedVersion,
    actualVersion: preparation.actualVersion,
    diagnostics: preparation.diagnostics,
  } as const;
  await writeFile(setupPlanPath, JSON.stringify(setup.value), { mode: 0o600 });
  await writeFile(preparedEnvironmentPath, JSON.stringify(preparation.environment), {
    mode: 0o600,
  });

  const cacheResolution = await resolvePackageManagerCachePath(setup.value, {
    ...process.env,
    ...preparation.environment,
  });
  let packageCache: CiActionState['packageCache'] = {
    status: 'UNAVAILABLE',
    manager: plan.packageManager.name,
    managerVersion: preparation.actualVersion,
  };
  let cacheDiagnostic: Diagnostic | undefined;
  let cachePlan: ReturnType<typeof resolvePackageManagerCachePlan> | undefined;
  if (!cacheResolution.ok) {
    cacheDiagnostic = {
      code: 'PACKAGE_CACHE_PATH_UNAVAILABLE',
      severity: 'warning',
      message: `Package-manager caching is unavailable: ${cacheResolution.message}`,
      source: plan.packageManager.name,
    };
  } else {
    try {
      const lockfileContents = await readFile(setup.value.install.lockfile);
      const managerVersion = managerVersionForCache(
        plan.packageManager.name,
        plan.packageManager.version,
        preparation.actualVersion ?? '',
      );
      cachePlan = resolvePackageManagerCachePlan(plan, {
        cachePath: cacheResolution.path,
        managerVersion,
        platform: process.platform,
        architecture: process.arch,
        lockfileContents,
      });
      packageCache = {
        status: 'NOT_ATTEMPTED',
        manager: cachePlan.manager,
        managerVersion: cachePlan.managerVersion,
        keyIdentity: cachePlan.keyIdentity,
      };
    } catch (error) {
      packageCache = { status: 'UNAVAILABLE', manager: plan.packageManager.name };
      cacheDiagnostic = {
        code: 'PACKAGE_CACHE_PLAN_FAILED',
        severity: 'warning',
        message: `Package-manager caching is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        source: plan.packageManager.name,
      };
    }
  }
  try {
    await writeCacheOutputs(cachePlan);
  } catch (error) {
    cachePlan = undefined;
    packageCache = { status: 'UNAVAILABLE', manager: plan.packageManager.name };
    cacheDiagnostic = {
      code: 'PACKAGE_CACHE_OUTPUT_UNAVAILABLE',
      severity: 'warning',
      message: `Package-manager caching is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      source: plan.packageManager.name,
    };
  }
  if (cacheDiagnostic) console.log(`WARNING ${cacheDiagnostic.code}: ${cacheDiagnostic.message}`);
  const latestState = await readActionState(statePath);
  await writeActionState(statePath, {
    ...latestState,
    setup: {
      status: 'IN_PROGRESS',
      currentStage: 'dependency-installation',
      runtimeVerification: runtime,
      preparation: preparationReport,
      diagnostics: [],
    },
    packageCache,
    diagnostics: cacheDiagnostic
      ? [...latestState.diagnostics, cacheDiagnostic]
      : latestState.diagnostics,
  });
  console.log(`Package-manager cache planned: ${packageCache.status}`);
}

async function install(): Promise<void> {
  const state = await readActionState(statePath);
  const setup = state.setup;
  if (!setup?.runtimeVerification || !setup.preparation)
    throw new Error(
      'Runtime and package-manager preparation must complete before immutable installation.',
    );
  const setupPlan = JSON.parse(await readFile(setupPlanPath, 'utf8')) as SetupPlan;
  const preparedEnvironment = JSON.parse(
    await readFile(preparedEnvironmentPath, 'utf8'),
  ) as NodeJS.ProcessEnv;
  const packageCache = applyCacheRestoreOutcome(
    state.packageCache,
    process.env.SHARED_CI_CACHE_RESTORE_OUTCOME,
    process.env.SHARED_CI_CACHE_HIT,
  );
  let diagnostics = state.diagnostics;
  if (packageCache.warning) diagnostics = appendCacheWarning(diagnostics, packageCache.warning);
  const cacheState = packageCache.state;
  await writeActionState(statePath, {
    ...state,
    packageCache: cacheState,
    diagnostics,
    setup: { ...setup, status: 'IN_PROGRESS', currentStage: 'dependency-installation' },
  });

  const installation = await installDependencies(setupPlan.install, {
    env: { ...process.env, ...preparedEnvironment },
  });
  logLines(installation.stdout);
  logLines(installation.stderr);
  if (installation.status !== 'PASSED') {
    const diagnostic: Diagnostic = {
      code: 'DEPENDENCY_INSTALLATION_FAILED',
      severity: 'error',
      message: `Immutable ${installation.packageManager} installation ${installation.status.toLowerCase()} (exit ${installation.exitCode ?? 'null'}).`,
      source: installation.command,
    };
    const latestState = await readActionState(statePath);
    await saveSetup(latestState, {
      status: installation.status,
      failedAt: 'dependency-installation',
      runtimeVerification: setup.runtimeVerification,
      preparation: setup.preparation,
      installation: {
        status: installation.status,
        packageManager: installation.packageManager,
        version: installation.version,
        lockfile: installation.lockfile,
        exitCode: installation.exitCode,
        signal: installation.signal,
      },
      diagnostics: [diagnostic],
    });
    throw new Error(diagnostic.message);
  }
  const latestState = await readActionState(statePath);
  await saveSetup(latestState, {
    status: 'PASSED',
    runtimeVerification: setup.runtimeVerification,
    preparation: setup.preparation,
    installation: {
      status: installation.status,
      packageManager: installation.packageManager,
      version: installation.version,
      lockfile: installation.lockfile,
      exitCode: installation.exitCode,
      signal: installation.signal,
    },
    diagnostics: [],
  });
  console.log('Dependencies installed successfully.');
}

async function runAllCapabilities(): Promise<void> {
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as ResolvedCiPlan;
  const preparedEnvironment = JSON.parse(
    await readFile(preparedEnvironmentPath, 'utf8'),
  ) as NodeJS.ProcessEnv;
  const projectRoot = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
  const state = await readActionState(statePath);
  const completed: Partial<
    Record<
      keyof typeof plan.capabilities,
      import('../src/execution/types.js').CapabilityExecutionResult
    >
  > = {};
  await writeActionState(statePath, { ...state, capabilities: capabilityReportRows(plan) });
  const result = await runCapabilities(plan, {
    projectRoot,
    env: { ...process.env, ...preparedEnvironment },
    onCapabilityResult: async (capability) => {
      completed[capability.capability] = capability;
      const latest = await readActionState(statePath);
      await writeActionState(statePath, {
        ...latest,
        capabilities: capabilityReportRows(plan, { capabilities: completed }),
      });
    },
  });
  for (const name of ['lint', 'typecheck', 'unit', 'integration', 'build', 'e2e'] as const) {
    const capability = result.capabilities[name];
    console.log(`::group::Shared CI capability: ${name} (${capability.discoveryState})`);
    if (capability.stdout) process.stdout.write(capability.stdout);
    if (capability.stderr) process.stderr.write(capability.stderr);
    console.log(
      `Result: ${capability.executionStatus}${capability.skipReason ? ` (${capability.skipReason})` : ''}; duration ${capability.durationMs}ms${capability.exitCode === null ? '' : `; exit ${capability.exitCode}`}`,
    );
    if (capability.error) console.error(`${capability.error.code}: ${capability.error.message}`);
    console.log('::endgroup::');
  }
  const completedState = await readActionState(statePath);
  await writeActionState(statePath, {
    ...completedState,
    capabilities: capabilityReportRows(plan, result),
    aggregate: result.status,
  });
  console.log(`Capability aggregate: ${result.status}`);
  if (result.status === 'FAILED') throw new Error('One or more capabilities failed or timed out.');
}

async function finalize(): Promise<void> {
  let state: CiActionState;
  try {
    state = await readActionState(statePath);
  } catch (error) {
    state = {
      ...createCiActionState(),
      preflightStatus: 'FAILED',
      diagnostics: [
        {
          code: 'ACTION_STATE_INVALID',
          severity: 'error',
          message: `Shared CI could not read its saved reporting state: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const nodeOutcome = process.env.SHARED_CI_SETUP_NODE_OUTCOME;
  const nodeSetupStatus =
    nodeOutcome === 'success'
      ? 'PASSED'
      : nodeOutcome === 'failure'
        ? 'FAILED'
        : nodeOutcome === 'skipped'
          ? 'NOT_REACHED'
          : nodeOutcome === undefined
            ? (state.nodeSetupStatus ?? 'NOT_REACHED')
            : 'IN_PROGRESS';
  state = { ...state, nodeSetupStatus };
  const packageCache = applyCacheSaveOutcome(
    state.packageCache,
    process.env.SHARED_CI_CACHE_SAVE_OUTCOME,
  );
  state = {
    ...state,
    packageCache: packageCache.state,
    diagnostics: packageCache.warning
      ? appendCacheWarning(state.diagnostics, packageCache.warning)
      : state.diagnostics,
  };
  await writeActionState(statePath, state);
  const summary = buildCiSummary(state);
  const result = await writeGithubStepSummary(summary, process.env.GITHUB_STEP_SUMMARY);
  if (result === 'UNAVAILABLE') {
    if (process.env.GITHUB_ACTIONS === 'true')
      throw new Error('GITHUB_STEP_SUMMARY is unavailable in a GitHub Actions run.');
    console.log(
      `GITHUB_STEP_SUMMARY unavailable; local rendering only.\n${renderCiSummaryMarkdown(summary)}`,
    );
    return;
  }
  for (const diagnostic of summary.diagnostics) console.log(renderDiagnosticAnnotation(diagnostic));
  console.log(`Shared CI summary written (${summary.result}).`);
}

async function saveSetup(state: CiActionState, setup: SetupReportState): Promise<void> {
  await writeActionState(statePath, { ...state, setup });
}

async function recordUnhandledFailure(phase: string | undefined, error: unknown): Promise<void> {
  if (phase === 'finalize') return;
  try {
    const state = await readActionState(statePath);
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic: Diagnostic = {
      code: 'ACTION_PHASE_FAILED',
      severity: 'error',
      message: `Shared CI ${phase ?? 'unknown'} phase failed: ${message}`,
    };
    if (phase === 'preflight') {
      if (state.preflightStatus !== 'FAILED')
        await writeActionState(statePath, {
          ...state,
          preflightStatus: 'FAILED',
          diagnostics: [...state.diagnostics, diagnostic],
        });
      return;
    }
    if (
      (phase === 'prepare' || phase === 'install') &&
      (!state.setup || state.setup.status === 'IN_PROGRESS' || state.setup.status === 'PASSED')
    )
      await writeActionState(statePath, {
        ...state,
        setup: {
          ...(state.setup ?? {}),
          status: 'FAILED',
          failedAt:
            state.setup?.currentStage === 'dependency-installation'
              ? 'dependency-installation'
              : state.setup?.currentStage === 'package-manager-preparation'
                ? 'package-manager-preparation'
                : 'runtime-verification',
          diagnostics: [...(state.setup?.diagnostics ?? []), diagnostic],
        },
        diagnostics: state.diagnostics,
      });
    if (phase === 'capabilities' && !state.capabilities)
      await writeActionState(statePath, {
        ...state,
        aggregate: 'FAILED',
        diagnostics: [...state.diagnostics, diagnostic],
      });
  } catch {
    // The always-run finalizer reports an incomplete run if transport itself was unavailable.
  }
}

async function writeCacheOutputs(
  cachePlan: ReturnType<typeof resolvePackageManagerCachePlan> | undefined,
): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('GITHUB_OUTPUT is unavailable.');
  const values = cachePlan
    ? {
        'cache-enabled': 'true',
        'cache-path': cachePlan.cachePath,
        'cache-key': cachePlan.primaryKey,
      }
    : { 'cache-enabled': 'false' };
  for (const value of Object.values(values))
    if (/[\r\n]/.test(value)) throw new Error('Cache output values must not contain line breaks.');
  await appendFile(
    output,
    `${Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')}\n`,
  );
}

function throwDiagnostics(diagnostics: readonly Diagnostic[]): never {
  logDiagnostics(diagnostics);
  throw new Error('Shared CI setup failed; see diagnostics above.');
}

function logDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const prefix = diagnostic.severity === 'error' ? 'ERROR' : 'WARNING';
    console.log(
      `${prefix} ${diagnostic.code}: ${diagnostic.message}${diagnostic.remediation ? ` ${diagnostic.remediation}` : ''}`,
    );
  }
}

function logLines(value: string | undefined): void {
  if (value) process.stdout.write(value);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
