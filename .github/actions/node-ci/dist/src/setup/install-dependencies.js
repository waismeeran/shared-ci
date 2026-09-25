import { executeCommand } from '../execution/execute-command.js';
export async function installDependencies(plan, options = {}) {
    const result = await executeCommand({
        command: plan.command,
        cwd: plan.workingDirectory,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.env ? { env: options.env } : {}),
    });
    return {
        ...result,
        packageManager: plan.packageManager,
        ...(plan.version ? { version: plan.version } : {}),
        lockfile: plan.lockfile,
        immutable: true,
    };
}
