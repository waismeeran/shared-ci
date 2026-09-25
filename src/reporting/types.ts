import type {
  CapabilityDiscoveryState,
  CapabilityName,
  Diagnostic,
  EvidenceSource,
  PackageManagerName,
  ResolvedCiPlan,
} from '../config/types.js';
import type { ExecutionStatus, SkipReason } from '../execution/types.js';
import type { PreparationStage, RuntimeVerification, SetupStatus } from '../setup/types.js';

export type ReportStageStatus = 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'IN_PROGRESS' | 'NOT_REACHED';
export type SummaryResult = 'PASS' | 'FAIL' | 'INCOMPLETE';
export type PackageCacheStatus = 'NOT_REACHED' | 'NOT_ATTEMPTED' | 'MISS' | 'HIT' | 'UNAVAILABLE';
export type PackageCacheSaveStatus = 'NOT_REACHED' | 'NOT_NEEDED' | 'SAVED' | 'UNAVAILABLE';

export interface PackageCacheReportState {
  readonly status: PackageCacheStatus;
  readonly manager?: PackageManagerName;
  readonly managerVersion?: string;
  readonly keyIdentity?: string;
  readonly saveStatus?: PackageCacheSaveStatus;
}

export interface SetupReportState {
  readonly status: ReportStageStatus;
  readonly failedAt?:
    'runtime-verification' | 'package-manager-preparation' | 'dependency-installation';
  readonly currentStage?:
    'runtime-verification' | 'package-manager-preparation' | 'dependency-installation';
  readonly runtimeVerification?: RuntimeVerification;
  readonly preparation?: Readonly<{
    status: SetupStatus;
    stage: PreparationStage;
    packageManager: PackageManagerName;
    expectedVersion?: string;
    actualVersion?: string;
    diagnostics: readonly Diagnostic[];
  }>;
  readonly installation?: Readonly<{
    status: SetupStatus;
    packageManager: PackageManagerName;
    version?: string;
    lockfile: string;
    exitCode: number | null;
    signal?: string;
  }>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CapabilityReportState {
  readonly capability: CapabilityName;
  readonly discoveryState: CapabilityDiscoveryState | 'NOT_RESOLVED';
  readonly executionStatus: ExecutionStatus | 'NOT_EXECUTED';
  readonly source?: string;
  readonly command?: string;
  readonly skipReason?: SkipReason | 'NOT_REACHED';
  readonly durationMs?: number;
  readonly exitCode?: number | null;
  readonly signal?: string;
  readonly error?: Readonly<{ code: string; message: string }>;
}

export interface CiActionState {
  readonly version: 1;
  readonly preflightStatus: 'PASSED' | 'FAILED' | 'NOT_REACHED';
  readonly projectDirectory?: string;
  readonly plan?: ResolvedCiPlan;
  readonly diagnostics: readonly Diagnostic[];
  readonly setup?: SetupReportState;
  readonly nodeSetupStatus?: ReportStageStatus;
  readonly capabilities?: readonly CapabilityReportState[];
  readonly aggregate?: 'PASSED' | 'FAILED';
  readonly packageCache?: PackageCacheReportState;
}

export interface CiSummaryModel {
  readonly result: SummaryResult;
  readonly projectDirectory?: string;
  readonly node?: Readonly<{ selector: string; source: EvidenceSource }>;
  readonly packageManager?: Readonly<{
    name: PackageManagerName;
    version?: string;
    source: EvidenceSource;
    lockfile: string;
  }>;
  readonly preflightStatus: CiActionState['preflightStatus'];
  readonly nodeSetupStatus: ReportStageStatus;
  readonly setup: SetupReportState;
  readonly capabilities: readonly CapabilityReportState[];
  readonly diagnostics: readonly Diagnostic[];
  readonly packageCache: PackageCacheReportState;
}
