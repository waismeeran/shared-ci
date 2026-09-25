import type { Diagnostic, ResolvedCiPlan } from '../config/types.js';
import { COREPACK_VERSION } from './types.js';
import type { RuntimeRequirement, RuntimeVerification } from './types.js';

export function runtimeRequirement(plan: ResolvedCiPlan): RuntimeRequirement {
  return { runtime: 'node', selector: plan.node.selector, source: plan.node.source };
}

/** Supports the resolver's numeric major, major.minor, and major.minor.patch selectors only. */
export function verifyNodeRuntime(
  requirement: RuntimeRequirement,
  actualVersion: string,
): RuntimeVerification {
  const selector = parseNumeric(requirement.selector);
  if (!selector) {
    return {
      status: 'UNSUPPORTED',
      requirement,
      actualVersion,
      diagnostic: diagnostic(
        'UNSUPPORTED_NODE_SELECTOR',
        `Cannot locally verify Node selector "${requirement.selector}"; use the accepted numeric selector form.`,
        'node-version',
      ),
    };
  }
  const actual = parseNumeric(actualVersion.replace(/^v/, ''));
  if (!actual || actual.length !== 3) {
    return {
      status: 'UNSUPPORTED',
      requirement,
      actualVersion,
      diagnostic: diagnostic(
        'INVALID_RUNTIME_VERSION',
        `Current Node version "${actualVersion}" is not a numeric major.minor.patch version.`,
        'process.version',
      ),
    };
  }
  const compatible = selector.every((part, index) => part === actual[index]);
  if (!compatible) {
    return {
      status: 'FAILED',
      requirement,
      actualVersion,
      diagnostic: diagnostic(
        'NODE_RUNTIME_MISMATCH',
        `Resolved Node ${requirement.selector} (${requirement.source}) does not match current runtime ${actualVersion}.`,
        requirement.source,
        'Run under the resolved Node version; runtime installation is handled by the future workflow adapter.',
      ),
    };
  }
  return { status: 'PASSED', requirement, actualVersion };
}

export function verifyCorepackRuntime(actualVersion: string): Diagnostic | undefined {
  const actual = parseNumeric(actualVersion.replace(/^v/, ''));
  if (!actual || actual.length !== 3)
    return diagnostic(
      'COREPACK_NODE_VERSION_UNSUPPORTED',
      `Corepack ${COREPACK_VERSION} requires Node >=22.22.2, >=24.15.0, or >=26.0.0; current runtime is ${actualVersion}.`,
      'process.version',
    );
  const major = actual[0]!;
  const supported =
    major > 26 ||
    major === 26 ||
    (major === 24 && compare(actual, [24, 15, 0]) >= 0) ||
    (major === 22 && compare(actual, [22, 22, 2]) >= 0);
  return supported
    ? undefined
    : diagnostic(
        'COREPACK_NODE_VERSION_UNSUPPORTED',
        `Corepack ${COREPACK_VERSION} requires Node >=22.22.2, >=24.15.0, or >=26.0.0; current runtime is ${actualVersion}.`,
        'process.version',
      );
}

function parseNumeric(value: string): number[] | undefined {
  if (!/^\d+(?:\.\d+){0,2}$/.test(value)) return undefined;
  return value.split('.').map(Number);
}
function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index++)
    if ((left[index] ?? 0) !== right[index]) return (left[index] ?? 0) - right[index]!;
  return 0;
}
function diagnostic(
  code: string,
  message: string,
  source: string,
  remediation?: string,
): Diagnostic {
  return { code, severity: 'error', message, source, ...(remediation ? { remediation } : {}) };
}
