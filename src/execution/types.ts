import type { CapabilityDiscoveryState, CapabilityName } from '../config/types.js';

export type ExecutionStatus = 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED';
export type SkipReason = 'ABSENT' | 'DISABLED' | 'PREREQUISITE_FAILED';

export interface CommandExecutionResult {
  readonly status: Exclude<ExecutionStatus, 'SKIPPED'>;
  readonly command: string;
  readonly workingDirectory: string;
  readonly exitCode: number | null;
  readonly signal?: string;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Readonly<{
    code:
      | 'EXECUTION_WORKING_DIRECTORY_NOT_FOUND'
      | 'COMMAND_SPAWN_FAILED'
      | 'INVALID_EXECUTION_COMMAND';
    message: string;
  }>;
}

export interface CapabilityExecutionResult {
  readonly capability: CapabilityName;
  readonly discoveryState: CapabilityDiscoveryState;
  readonly executionStatus: ExecutionStatus;
  readonly command?: string;
  readonly workingDirectory: string;
  readonly exitCode: number | null;
  readonly signal?: string;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly skipReason?: SkipReason;
  readonly error?: CommandExecutionResult['error'];
}

export interface ExecuteCommandOptions {
  readonly command: string;
  readonly cwd: string;
  /** Internal bounded execution timeout. This is not a consumer workflow input. */
  readonly timeoutMs?: number;
  /** Partial overrides are merged with the inherited process environment. */
  readonly env?: NodeJS.ProcessEnv;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
}

export interface ExecuteCapabilityOptions extends Omit<ExecuteCommandOptions, 'command' | 'cwd'> {
  readonly projectRoot: string;
}
