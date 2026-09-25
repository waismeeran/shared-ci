export { inspectProject } from './discovery/project.js';
export { resolveCiPlan } from './discovery/plan.js';
export type { ProjectEvidence } from './discovery/plan.js';
export { parsePackageJson } from './discovery/package-json.js';
export { resolvePackageManager } from './discovery/package-manager.js';
export { resolveNodeVersion } from './discovery/node-version.js';
export { resolveCapabilities } from './discovery/capabilities.js';
export { validateConfig } from './config/validation.js';
export type * from './config/types.js';
export { executeCommand } from './execution/execute-command.js';
export { executeCapability } from './execution/execute-capability.js';
export { capabilityOrder, runCapabilities } from './execution/run-capabilities.js';
export type {
  CapabilityRunName,
  CapabilityRunResult,
  RunCapabilitiesOptions,
} from './execution/run-capabilities.js';
export type * from './execution/types.js';
export { buildCiSummary, capabilityReportRows } from './reporting/summary-model.js';
export { renderCiSummaryMarkdown } from './reporting/render-markdown.js';
export { renderDiagnosticAnnotation } from './reporting/diagnostics.js';
export {
  appendCacheWarning,
  applyCacheRestoreOutcome,
  applyCacheSaveOutcome,
} from './reporting/package-cache-state.js';
export type * from './reporting/types.js';
export { runtimeRequirement, verifyCorepackRuntime, verifyNodeRuntime } from './setup/runtime.js';
export { createDependencyInstallPlan, createSetupPlan } from './setup/install-plan.js';
export { preparePackageManager } from './setup/prepare-package-manager.js';
export { installDependencies } from './setup/install-dependencies.js';
export { prepareAndInstall } from './setup/prepare-and-install.js';
export { resolvePackageManagerCachePlan } from './setup/package-manager-cache.js';
export type {
  PackageManagerCacheInputs,
  PackageManagerCachePlan,
} from './setup/package-manager-cache.js';
export {
  managerVersionForCache,
  resolvePackageManagerCachePath,
} from './setup/package-manager-cache-path.js';
export type { CachePathResolution } from './setup/package-manager-cache-path.js';
export type * from './setup/types.js';
