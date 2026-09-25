import { resolve } from 'node:path';
import { executeCapability } from './execute-capability.js';
import { resolveExecutionDirectory } from './execute-command.js';
export const capabilityOrder = [
    'lint',
    'typecheck',
    'unit',
    'integration',
    'build',
    'e2e',
];
const independentChecks = ['lint', 'typecheck', 'unit', 'integration'];
/** Runs all V1 capabilities in a fixed sequence, continuing independent checks and gating later stages. */
export async function runCapabilities(plan, options) {
    const { onCapabilityResult, ...executionOptions } = options;
    const capabilities = {};
    for (const name of independentChecks) {
        capabilities[name] = await executeCapability(plan, name, executionOptions);
        await onCapabilityResult?.(capabilities[name]);
    }
    const checksFailed = independentChecks.some((name) => isBlockingFailure(capabilities[name].executionStatus));
    capabilities.build =
        checksFailed && isExecutable(plan, 'build')
            ? await skippedCapability(plan, 'build', options.projectRoot)
            : await executeCapability(plan, 'build', executionOptions);
    await onCapabilityResult?.(capabilities.build);
    const earlierStageFailed = checksFailed || isBlockingFailure(capabilities.build.executionStatus);
    capabilities.e2e =
        earlierStageFailed && isExecutable(plan, 'e2e')
            ? await skippedCapability(plan, 'e2e', options.projectRoot)
            : await executeCapability(plan, 'e2e', executionOptions);
    await onCapabilityResult?.(capabilities.e2e);
    return {
        status: Object.values(capabilities).some((result) => isBlockingFailure(result.executionStatus))
            ? 'FAILED'
            : 'PASSED',
        capabilities,
    };
}
function isExecutable(plan, name) {
    const state = plan.capabilities[name].state;
    return state === 'DETECTED' || state === 'OVERRIDDEN';
}
function isBlockingFailure(status) {
    return status === 'FAILED' || status === 'TIMED_OUT';
}
async function skippedCapability(plan, name, projectRoot) {
    const resolvedDirectory = await resolveExecutionDirectory(projectRoot, plan.project.workingDirectory);
    return {
        capability: name,
        discoveryState: plan.capabilities[name].state,
        executionStatus: 'SKIPPED',
        command: plan.capabilities[name].command?.value,
        workingDirectory: resolvedDirectory ?? resolve(projectRoot, plan.project.workingDirectory),
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        skipReason: 'PREREQUISITE_FAILED',
    };
}
