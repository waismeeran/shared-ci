import { isAbsolute, relative, resolve, sep } from 'node:path';
import { resolveExecutionDirectory } from '../execution/execute-command.js';
import { COREPACK_VERSION } from './types.js';
import { runtimeRequirement } from './runtime.js';
export async function createSetupPlan(plan, options) {
    const workingDirectory = await resolveExecutionDirectory(options.projectRoot, plan.project.workingDirectory);
    if (!workingDirectory)
        return {
            ok: false,
            diagnostics: [
                {
                    code: 'EXECUTION_WORKING_DIRECTORY_NOT_FOUND',
                    severity: 'error',
                    message: `Resolved project directory is missing or escapes project root: ${plan.project.workingDirectory}`,
                    source: plan.project.workingDirectory,
                },
            ],
        };
    const toolingDirectory = resolve(options.toolingDirectory);
    const rel = relative(resolve(options.projectRoot), toolingDirectory);
    if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
        return {
            ok: false,
            diagnostics: [
                {
                    code: 'INVALID_TOOLING_DIRECTORY',
                    severity: 'error',
                    message: 'The isolated tooling directory must be outside the consumer project root.',
                    source: toolingDirectory,
                },
            ],
        };
    const { name, version } = plan.packageManager;
    if ((name === 'pnpm' || name === 'yarn') && !version)
        return {
            ok: false,
            diagnostics: [
                {
                    code: 'PACKAGE_MANAGER_VERSION_REQUIRED',
                    severity: 'error',
                    message: `${name} preparation requires an exact packageManager version in package.json.`,
                    source: 'package.json packageManager',
                },
            ],
        };
    const corepackExecutable = resolve(toolingDirectory, 'node_modules/.bin/corepack');
    const managerCommand = managerExecutable(name);
    const managerEnvironment = name === 'npm'
        ? {}
        : {
            COREPACK_HOME: resolve(toolingDirectory, 'corepack-home'),
            COREPACK_DEFAULT_TO_LATEST: '0',
            COREPACK_ENABLE_AUTO_PIN: '0',
            COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        };
    const install = createDependencyInstallPlan(plan, workingDirectory);
    return {
        ok: true,
        value: {
            runtime: runtimeRequirement(plan),
            packageManager: { name, ...(version ? { version } : {}) },
            projectDirectory: workingDirectory,
            toolingDirectory,
            npmAvailabilityCommand: 'npm --version',
            ...(name === 'npm'
                ? {}
                : {
                    corepackInstallCommand: `npm install --prefix ${shellQuote(toolingDirectory)} --no-save --no-package-lock corepack@${COREPACK_VERSION}`,
                    corepackExecutable,
                    corepackVersionCommand: `${shellQuote(corepackExecutable)} --version`,
                    managerActivationCommand: `${shellQuote(corepackExecutable)} install -g ${name}@${version}`,
                }),
            managerVersionCommand: `${managerCommand} --version`,
            managerInstallCommand: install.command,
            install,
            ...(name === 'npm'
                ? {}
                : { managerBinDirectory: resolve(toolingDirectory, 'node_modules/.bin') }),
            managerEnvironment,
        },
    };
}
export function createDependencyInstallPlan(plan, workingDirectory) {
    const { name, version, lockfile } = plan.packageManager;
    const command = installCommand(name);
    return {
        packageManager: name,
        ...(version ? { version } : {}),
        lockfile: resolve(workingDirectory, lockfile),
        workingDirectory,
        command,
        immutable: true,
    };
}
function managerExecutable(name) {
    return name;
}
function installCommand(name) {
    switch (name) {
        case 'npm':
            return 'npm ci';
        case 'pnpm':
            return 'pnpm install --frozen-lockfile';
        case 'yarn':
            return 'yarn install --immutable';
    }
}
function shellQuote(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
