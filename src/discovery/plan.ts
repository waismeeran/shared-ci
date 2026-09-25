import type {
  CiConfig,
  Diagnostic,
  NodeVersionEvidence,
  PackageManagerEvidence,
  PackageManifest,
  ResolvedCiPlan,
  Resolution,
} from '../config/types.js';
import { validateConfig } from '../config/validation.js';
import { resolveCapabilities } from './capabilities.js';
import { resolveNodeVersion } from './node-version.js';
import { resolvePackageManager } from './package-manager.js';

export interface ProjectEvidence {
  readonly workingDirectory: string;
  readonly manifest: PackageManifest;
  readonly node: NodeVersionEvidence;
  readonly lockfiles: readonly string[];
}
export function resolveCiPlan(
  config: CiConfig,
  evidence: ProjectEvidence,
): Resolution<ResolvedCiPlan> {
  const diagnostics: Diagnostic[] = [...validateConfig(config)];
  const node = resolveNodeVersion({
    ...evidence.node,
    ...(config['node-version'] === undefined ? {} : { explicit: config['node-version'] }),
  });
  const managerEvidence: PackageManagerEvidence = {
    lockfiles: evidence.lockfiles,
    ...(config['package-manager'] ? { explicit: config['package-manager'] } : {}),
    ...(evidence.manifest.packageManager
      ? { packageManager: evidence.manifest.packageManager }
      : {}),
  };
  const manager = resolvePackageManager(managerEvidence);
  const capabilities = resolveCapabilities(config, evidence.manifest);
  diagnostics.push(...node.diagnostics, ...manager.diagnostics, ...capabilities.diagnostics);
  if (
    !node.ok ||
    !manager.ok ||
    !capabilities.ok ||
    diagnostics.some((item) => item.severity === 'error')
  )
    return { ok: false, diagnostics };
  return {
    ok: true,
    value: {
      project: { workingDirectory: evidence.workingDirectory },
      node: node.value,
      packageManager: manager.value,
      capabilities: capabilities.value,
      diagnostics,
    },
    diagnostics,
  };
}
