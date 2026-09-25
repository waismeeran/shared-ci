import type { Diagnostic, NodeVersionEvidence, Resolution } from '../config/types.js';

export interface ResolvedNode {
  readonly selector: string;
  readonly source: 'input' | '.nvmrc' | '.node-version' | 'engines.node' | 'shared-default';
}
export function resolveNodeVersion(evidence: NodeVersionEvidence): Resolution<ResolvedNode> {
  const diagnostics: Diagnostic[] = [];
  const entries = [
    ...(evidence.nvmrc === undefined ? [] : [{ value: evidence.nvmrc, source: '.nvmrc' as const }]),
    ...(evidence.nodeVersionFile === undefined
      ? []
      : [{ value: evidence.nodeVersionFile, source: '.node-version' as const }]),
    ...(evidence.enginesNode === undefined
      ? []
      : [{ value: evidence.enginesNode, source: 'engines.node' as const }]),
  ];
  const valid = entries.filter((entry) => {
    if (!/^\d+(?:\.\d+){0,2}$/.test(entry.value.trim())) {
      diagnostics.push({
        code: 'INVALID_NODE_VERSION',
        severity: 'error',
        message: `${entry.source} must contain a numeric Node selector (major, major.minor, or major.minor.patch), received "${entry.value}".`,
        source: entry.source,
        remediation: 'Use a numeric selector or set node-version explicitly.',
      });
      return false;
    }
    return true;
  });
  const explicit = evidence.explicit;
  if (explicit !== undefined && !/^\d+(?:\.\d+){0,2}$/.test(explicit.trim()))
    diagnostics.push({
      code: 'INVALID_NODE_VERSION',
      severity: 'error',
      message: `node-version must be a numeric selector, received "${explicit}".`,
      source: 'node-version input',
    });
  if (diagnostics.some((item) => item.severity === 'error')) return { ok: false, diagnostics };
  if (explicit !== undefined) {
    for (const declaration of valid)
      if (declaration.value.trim() !== explicit.trim())
        diagnostics.push({
          code: 'NODE_VERSION_OVERRIDE',
          severity: 'warning',
          message: `node-version input ${explicit} overrides ${declaration.source}=${declaration.value}.`,
          source: declaration.source,
        });
    return { ok: true, value: { selector: explicit.trim(), source: 'input' }, diagnostics };
  }
  const distinct = new Set(valid.map(({ value }) => value.trim()));
  if (distinct.size > 1)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'NODE_VERSION_CONFLICT',
          severity: 'error',
          message: `Node version declarations conflict: ${valid.map((e) => `${e.source}=${e.value}`).join(', ')}.`,
          remediation: 'Align repository declarations or set node-version explicitly.',
        },
      ],
    };
  const first = valid[0];
  if (first)
    return { ok: true, value: { selector: first.value.trim(), source: first.source }, diagnostics };
  return { ok: true, value: { selector: '24', source: 'shared-default' }, diagnostics };
}
