import { access, mkdir } from 'node:fs/promises';
import { executeCommand } from '../execution/execute-command.js';
import { COREPACK_VERSION } from './types.js';
export async function preparePackageManager(plan, options = {}) {
    const base = {
        packageManager: plan.packageManager.name,
        ...(plan.packageManager.version ? { expectedVersion: plan.packageManager.version } : {}),
    };
    const stage = async (name, command, env = options.env ?? {}) => {
        const execution = {
            command,
            cwd: plan.projectDirectory,
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
            env,
        };
        return executeCommand(execution);
    };
    try {
        if (plan.packageManager.name !== 'npm')
            await mkdir(plan.toolingDirectory, { recursive: true });
    }
    catch (error) {
        const diagnostic = {
            code: 'COREPACK_INSTALLATION_FAILED',
            severity: 'error',
            message: `Could not create isolated tooling directory: ${error instanceof Error ? error.message : String(error)}`,
            source: plan.toolingDirectory,
        };
        return {
            ...base,
            status: 'FAILED',
            stage: 'COREPACK_INSTALLATION',
            diagnostics: [diagnostic],
            environment: {},
        };
    }
    let result = await stage('NPM_AVAILABILITY', plan.npmAvailabilityCommand);
    if (result.status !== 'PASSED')
        return failed(base, 'NPM_AVAILABILITY', result, 'PACKAGE_MANAGER_UNAVAILABLE', 'npm is required by the resolved setup policy and could not be run.');
    const npmExpected = plan.packageManager.name === 'npm' ? plan.packageManager.version : undefined;
    const npmActual = result.stdout.trim();
    if (npmExpected && npmActual !== npmExpected)
        return failed(base, 'NPM_AVAILABILITY', result, 'PACKAGE_MANAGER_VERSION_MISMATCH', `Expected bundled npm ${npmExpected}, but found ${npmActual || '(no version output)'}.`);
    if (plan.packageManager.name === 'npm') {
        return {
            ...base,
            status: 'PASSED',
            stage: 'READY',
            actualVersion: npmActual,
            diagnostics: [],
            environment: {},
        };
    }
    const corepackInstall = plan.corepackInstallCommand;
    const corepackPath = plan.corepackExecutable;
    const corepackVersionCommand = plan.corepackVersionCommand;
    const activation = plan.managerActivationCommand;
    if (!corepackInstall ||
        !corepackPath ||
        !corepackVersionCommand ||
        !activation ||
        !plan.packageManager.version) {
        return {
            ...base,
            status: 'FAILED',
            stage: 'COREPACK_INSTALLATION',
            diagnostics: [
                {
                    code: 'COREPACK_UNAVAILABLE',
                    severity: 'error',
                    message: 'The resolved setup plan is missing a pinned Corepack preparation command or package-manager version.',
                },
            ],
            environment: {},
        };
    }
    const managerEnvironment = {
        ...plan.managerEnvironment,
        ...(plan.managerBinDirectory
            ? { PATH: `${plan.managerBinDirectory}:${options.env?.PATH ?? process.env.PATH ?? ''}` }
            : {}),
    };
    const isolatedEnv = { ...(options.env ?? {}), ...managerEnvironment };
    result = await stage('COREPACK_INSTALLATION', corepackInstall, isolatedEnv);
    if (result.status !== 'PASSED')
        return failed(base, 'COREPACK_INSTALLATION', result, 'COREPACK_INSTALLATION_FAILED', `Installing pinned Corepack ${COREPACK_VERSION} in the isolated tooling directory failed.`);
    try {
        await access(corepackPath);
    }
    catch {
        return {
            ...base,
            status: 'FAILED',
            stage: 'COREPACK_AVAILABILITY',
            diagnostics: [
                {
                    code: 'COREPACK_UNAVAILABLE',
                    severity: 'error',
                    message: `Pinned Corepack ${COREPACK_VERSION} was not present after installation.`,
                    source: corepackPath,
                },
            ],
            environment: managerEnvironment,
        };
    }
    result = await stage('COREPACK_VERSION_VERIFICATION', corepackVersionCommand, isolatedEnv);
    if (result.status !== 'PASSED')
        return failed(base, 'COREPACK_VERSION_VERIFICATION', result, 'COREPACK_UNAVAILABLE', `Could not verify isolated Corepack ${COREPACK_VERSION}.`);
    const corepackActual = result.stdout.trim().replace(/^v/, '');
    if (corepackActual !== COREPACK_VERSION)
        return failed(base, 'COREPACK_VERSION_VERIFICATION', result, 'COREPACK_VERSION_MISMATCH', `Expected Corepack ${COREPACK_VERSION}, but found ${corepackActual || '(no version output)'}.`);
    result = await stage('PACKAGE_MANAGER_ACTIVATION', activation, isolatedEnv);
    if (result.status !== 'PASSED')
        return failed(base, 'PACKAGE_MANAGER_ACTIVATION', result, 'PACKAGE_MANAGER_PREPARATION_FAILED', `Corepack could not prepare the pinned ${plan.packageManager.name}@${plan.packageManager.version}.`);
    result = await stage('PACKAGE_MANAGER_VERSION_VERIFICATION', plan.managerVersionCommand, isolatedEnv);
    if (result.status !== 'PASSED')
        return failed(base, 'PACKAGE_MANAGER_VERSION_VERIFICATION', result, 'PACKAGE_MANAGER_UNAVAILABLE', `Could not run the prepared ${plan.packageManager.name} manager.`);
    const managerActual = result.stdout.trim().replace(/^v/, '');
    if (managerActual !== plan.packageManager.version)
        return failed(base, 'PACKAGE_MANAGER_VERSION_VERIFICATION', result, 'PACKAGE_MANAGER_VERSION_MISMATCH', `Expected ${plan.packageManager.name} ${plan.packageManager.version}, but found ${managerActual || '(no version output)'}.`);
    return {
        ...base,
        status: 'PASSED',
        stage: 'READY',
        actualVersion: managerActual,
        diagnostics: [],
        environment: managerEnvironment,
    };
}
function failed(base, stage, commandResult, code, message) {
    const status = commandResult.status === 'TIMED_OUT' ? 'TIMED_OUT' : 'FAILED';
    return {
        ...base,
        stage,
        status,
        commandResult,
        diagnostics: [{ code, severity: 'error', message, source: commandResult.command }],
        environment: {},
    };
}
