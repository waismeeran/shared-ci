export const capabilityNames = [
  'lint',
  'typecheck',
  'unit',
  'integration',
  'build',
  'e2e',
] as const;
export type CapabilityName = (typeof capabilityNames)[number];
export type CapabilityMode = 'auto' | 'true' | 'false';
export type CapabilityDiscoveryState = 'DETECTED' | 'OVERRIDDEN' | 'DISABLED' | 'ABSENT';
export type PackageManagerName = 'npm' | 'pnpm' | 'yarn';
export type EvidenceSource =
  | 'input'
  | 'package-json'
  | 'lockfile'
  | '.nvmrc'
  | '.node-version'
  | 'engines.node'
  | 'shared-default';
export type Diagnostic = Readonly<{
  code: string;
  severity: 'error' | 'warning';
  message: string;
  source?: string;
  remediation?: string;
}>;

export interface CiConfig {
  readonly 'working-directory'?: string;
  readonly 'node-version'?: string;
  readonly 'package-manager'?: string;
  readonly lint?: string;
  readonly typecheck?: string;
  readonly unit?: string;
  readonly integration?: string;
  readonly build?: string;
  readonly e2e?: string;
  readonly 'lint-command'?: string;
  readonly 'typecheck-command'?: string;
  readonly 'unit-command'?: string;
  readonly 'integration-command'?: string;
  readonly 'build-command'?: string;
  readonly 'e2e-command'?: string;
}

export interface PackageManagerEvidence {
  readonly explicit?: string;
  readonly packageManager?: string;
  readonly lockfiles: readonly string[];
}
export interface NodeVersionEvidence {
  readonly explicit?: string;
  readonly nvmrc?: string;
  readonly nodeVersionFile?: string;
  readonly enginesNode?: string;
}
export interface PackageManifest {
  readonly scripts: Readonly<Record<string, string>>;
  readonly packageManager?: string;
  readonly enginesNode?: string;
}
export interface ResolvedCapability {
  readonly mode: CapabilityMode;
  readonly state: CapabilityDiscoveryState;
  readonly source?: 'override' | 'package-script';
  readonly command?: Readonly<{ kind: 'opaque' | 'package-script'; value: string }>;
}
export interface ResolvedCiPlan {
  readonly project: Readonly<{ workingDirectory: string }>;
  readonly node: Readonly<{ selector: string; source: EvidenceSource }>;
  readonly packageManager: Readonly<{
    name: PackageManagerName;
    version?: string;
    source: EvidenceSource;
    lockfile: string;
  }>;
  readonly capabilities: Readonly<Record<CapabilityName, ResolvedCapability>>;
  readonly diagnostics: readonly Diagnostic[];
}
export type Resolution<T> =
  | Readonly<{ ok: true; value: T; diagnostics: readonly Diagnostic[] }>
  | Readonly<{ ok: false; diagnostics: readonly Diagnostic[] }>;
