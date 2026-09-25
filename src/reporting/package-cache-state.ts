import type { Diagnostic } from '../config/types.js';
import type { PackageCacheReportState } from './types.js';

export function applyCacheRestoreOutcome(
  previous: PackageCacheReportState | undefined,
  outcome: string | undefined,
  cacheHit: string | undefined,
): { state: PackageCacheReportState; warning?: Diagnostic } {
  const current = previous ?? { status: 'NOT_REACHED' as const };
  if (current.status === 'UNAVAILABLE' || current.status === 'NOT_REACHED')
    return { state: current };
  if (outcome === 'success' && cacheHit === 'true') return { state: { ...current, status: 'HIT' } };
  // actions/cache/restore leaves cache-hit empty on a cache miss; only exact hits are "true".
  if (outcome === 'success' && cacheHit !== 'true')
    return { state: { ...current, status: 'MISS' } };
  if (outcome === 'failure')
    return {
      state: { ...current, status: 'UNAVAILABLE' },
      warning: {
        code: 'PACKAGE_CACHE_RESTORE_UNAVAILABLE',
        severity: 'warning',
        message:
          'GitHub Actions cache restore was unavailable; immutable installation will continue without a restored cache.',
      },
    };
  return { state: current };
}

export function applyCacheSaveOutcome(
  previous: PackageCacheReportState | undefined,
  outcome: string | undefined,
): { state: PackageCacheReportState; warning?: Diagnostic } {
  const current = previous ?? { status: 'NOT_REACHED' as const };
  if (current.status === 'HIT') return { state: { ...current, saveStatus: 'NOT_NEEDED' } };
  if (current.status !== 'MISS') return { state: current };
  if (outcome === 'success') return { state: { ...current, saveStatus: 'SAVED' } };
  if (outcome === 'failure')
    return {
      state: { ...current, saveStatus: 'UNAVAILABLE' },
      warning: {
        code: 'PACKAGE_CACHE_SAVE_UNAVAILABLE',
        severity: 'warning',
        message:
          'GitHub Actions cache save was unavailable; dependency installation and workflow results are unchanged.',
      },
    };
  return { state: { ...current, saveStatus: 'NOT_REACHED' } };
}

export function appendCacheWarning(
  diagnostics: readonly Diagnostic[],
  warning: Diagnostic,
): readonly Diagnostic[] {
  return diagnostics.some((diagnostic) => diagnostic.code === warning.code)
    ? diagnostics
    : [...diagnostics, warning];
}
