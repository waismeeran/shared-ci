import { resolve } from 'node:path';
import type { CapabilityName, ResolvedCiPlan } from '../config/types.js';
import { executeCommand, resolveExecutionDirectory } from './execute-command.js';
import type { CapabilityExecutionResult, ExecuteCapabilityOptions } from './types.js';

export async function executeCapability(
  plan: ResolvedCiPlan,
  capabilityName: CapabilityName,
  options: ExecuteCapabilityOptions,
): Promise<CapabilityExecutionResult> {
  const capability = plan.capabilities[capabilityName];
  const directory = await resolveExecutionDirectory(
    options.projectRoot,
    plan.project.workingDirectory,
  );
  const workingDirectory = directory ?? resolve(options.projectRoot, plan.project.workingDirectory);
  if (capability.state === 'ABSENT' || capability.state === 'DISABLED') {
    const skipReason = capability.state;
    return {
      capability: capabilityName,
      discoveryState: capability.state,
      executionStatus: 'SKIPPED',
      workingDirectory,
      exitCode: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      skipReason,
    };
  }
  if (!directory) {
    return {
      capability: capabilityName,
      discoveryState: capability.state,
      executionStatus: 'FAILED',
      command: capability.command?.value,
      workingDirectory,
      exitCode: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      error: {
        code: 'EXECUTION_WORKING_DIRECTORY_NOT_FOUND',
        message: `Execution project directory does not exist or escapes project root: ${plan.project.workingDirectory}`,
      },
    };
  }
  if (!capability.command) {
    return {
      capability: capabilityName,
      discoveryState: capability.state,
      executionStatus: 'FAILED',
      workingDirectory,
      exitCode: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      error: {
        code: 'INVALID_EXECUTION_COMMAND',
        message: `Resolved capability "${capabilityName}" has no command.`,
      },
    };
  }
  const command =
    capability.command.kind === 'opaque'
      ? capability.command.value
      : packageScriptCommand(plan.packageManager.name, capability.command.value);
  const result = await executeCommand({ ...options, cwd: directory, command });
  return {
    capability: capabilityName,
    discoveryState: capability.state,
    executionStatus: result.status,
    command: result.command,
    workingDirectory: result.workingDirectory,
    exitCode: result.exitCode,
    ...(result.signal ? { signal: result.signal } : {}),
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error ? { error: result.error } : {}),
  };
}

function packageScriptCommand(
  manager: ResolvedCiPlan['packageManager']['name'],
  script: string,
): string {
  switch (manager) {
    case 'npm':
      return `npm run ${script}`;
    case 'pnpm':
      return `pnpm run ${script}`;
    case 'yarn':
      return `yarn run ${script}`;
  }
}
