import { createSetupPlan } from './install-plan.js';
import { installDependencies } from './install-dependencies.js';
import { preparePackageManager } from './prepare-package-manager.js';
import { runtimeRequirement, verifyCorepackRuntime, verifyNodeRuntime } from './runtime.js';
export async function prepareAndInstall(plan, options) {
    const actualNodeVersion = options.actualNodeVersion ?? process.version;
    const runtimeVerification = verifyNodeRuntime(runtimeRequirement(plan), actualNodeVersion);
    if (runtimeVerification.status !== 'PASSED')
        return {
            status: 'FAILED',
            failedAt: 'runtime-verification',
            runtimeVerification,
            diagnostics: runtimeVerification.diagnostic ? [runtimeVerification.diagnostic] : [],
        };
    if (plan.packageManager.name !== 'npm') {
        const corepackDiagnostic = verifyCorepackRuntime(actualNodeVersion);
        if (corepackDiagnostic) {
            const preparation = {
                status: 'FAILED',
                stage: 'COREPACK_INSTALLATION',
                packageManager: plan.packageManager.name,
                ...(plan.packageManager.version ? { expectedVersion: plan.packageManager.version } : {}),
                diagnostics: [corepackDiagnostic],
                environment: {},
            };
            return {
                status: 'FAILED',
                failedAt: 'package-manager-preparation',
                runtimeVerification,
                preparation,
                diagnostics: [corepackDiagnostic],
            };
        }
    }
    const setup = await createSetupPlan(plan, options);
    if (!setup.ok) {
        const preparation = {
            status: 'FAILED',
            stage: 'COREPACK_INSTALLATION',
            packageManager: plan.packageManager.name,
            ...(plan.packageManager.version ? { expectedVersion: plan.packageManager.version } : {}),
            diagnostics: setup.diagnostics,
            environment: {},
        };
        return {
            status: 'FAILED',
            failedAt: 'package-manager-preparation',
            runtimeVerification,
            preparation,
            diagnostics: setup.diagnostics,
        };
    }
    const preparation = await preparePackageManager(setup.value, options);
    if (preparation.status !== 'PASSED')
        return {
            status: preparation.status,
            failedAt: 'package-manager-preparation',
            runtimeVerification,
            preparation,
            diagnostics: preparation.diagnostics,
        };
    const installation = await installDependencies(setup.value.install, {
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        env: { ...(options.env ?? {}), ...preparation.environment },
    });
    const diagnostics = installation.status === 'PASSED'
        ? []
        : [
            {
                code: 'DEPENDENCY_INSTALLATION_FAILED',
                severity: 'error',
                message: `Immutable ${installation.packageManager} dependency installation failed with exit code ${installation.exitCode ?? 'null'}${installation.signal ? ` (signal ${installation.signal})` : ''}.`,
                source: installation.command,
            },
        ];
    return {
        status: installation.status,
        ...(installation.status === 'PASSED' ? {} : { failedAt: 'dependency-installation' }),
        runtimeVerification,
        preparation,
        installation,
        diagnostics,
    };
}
