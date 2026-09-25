import type { Diagnostic, PackageManagerName, ResolvedCiPlan } from '../config/types.js';
import type { CommandExecutionResult } from '../execution/types.js';

export const COREPACK_VERSION = '0.36.0';
export type SetupStatus = 'PASSED' | 'FAILED' | 'TIMED_OUT';
export type PreparationStage =
  | 'NPM_AVAILABILITY'
  | 'COREPACK_INSTALLATION'
  | 'COREPACK_AVAILABILITY'
  | 'COREPACK_VERSION_VERIFICATION'
  | 'PACKAGE_MANAGER_ACTIVATION'
  | 'PACKAGE_MANAGER_VERSION_VERIFICATION'
  | 'SETUP_PLAN'
  | 'READY';

export interface RuntimeRequirement {
  readonly runtime: 'node';
  readonly selector: string;
  readonly source: ResolvedCiPlan['node']['source'];
}

export interface RuntimeVerification {
  readonly status: 'PASSED' | 'FAILED' | 'UNSUPPORTED';
  readonly requirement: RuntimeRequirement;
  readonly actualVersion: string;
  readonly diagnostic?: Diagnostic;
}

export interface SetupPlan {
  readonly runtime: RuntimeRequirement;
  readonly packageManager: Readonly<{ name: PackageManagerName; version?: string }>;
  readonly projectDirectory: string;
  readonly toolingDirectory: string;
  readonly npmAvailabilityCommand: 'npm --version';
  readonly corepackInstallCommand?: string;
  readonly corepackExecutable?: string;
  readonly corepackVersionCommand?: string;
  readonly managerActivationCommand?: string;
  readonly managerVersionCommand: string;
  readonly managerInstallCommand: string;
  readonly install: DependencyInstallPlan;
  readonly managerBinDirectory?: string;
  readonly managerEnvironment: NodeJS.ProcessEnv;
}

export interface DependencyInstallPlan {
  readonly packageManager: PackageManagerName;
  readonly version?: string;
  readonly lockfile: string;
  readonly workingDirectory: string;
  readonly command: string;
  readonly immutable: true;
}

export interface SetupOptions {
  readonly projectRoot: string;
  /** Isolated ephemeral directory for Corepack and its package-manager store. */
  readonly toolingDirectory: string;
  readonly actualNodeVersion?: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface PreparationResult {
  readonly status: SetupStatus;
  readonly stage: PreparationStage;
  readonly packageManager: PackageManagerName;
  readonly expectedVersion?: string;
  readonly actualVersion?: string;
  readonly commandResult?: CommandExecutionResult;
  readonly diagnostics: readonly Diagnostic[];
  readonly environment: NodeJS.ProcessEnv;
}

export interface DependencyInstallationResult extends CommandExecutionResult {
  readonly packageManager: PackageManagerName;
  readonly version?: string;
  readonly lockfile: string;
  readonly immutable: true;
}

export interface SetupAndInstallResult {
  readonly status: SetupStatus;
  readonly failedAt?:
    'runtime-verification' | 'package-manager-preparation' | 'dependency-installation';
  readonly runtimeVerification: RuntimeVerification;
  readonly preparation?: PreparationResult;
  readonly installation?: DependencyInstallationResult;
  readonly diagnostics: readonly Diagnostic[];
}
