import type { Diagnostic, PackageManifest, Resolution } from '../config/types.js';

export function parsePackageJson(
  text: string,
  source = 'package.json',
): Resolution<PackageManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'INVALID_PACKAGE_JSON',
          severity: 'error',
          message: `${source} is not valid JSON.`,
          source,
          remediation: 'Fix the JSON syntax and try again.',
        },
      ],
    };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return invalid(source, 'The package manifest must contain a JSON object.');
  const data = raw as Record<string, unknown>;
  const diagnostics: Diagnostic[] = [];
  const scripts: Record<string, string> = {};
  if (data.scripts !== undefined) {
    if (typeof data.scripts !== 'object' || data.scripts === null || Array.isArray(data.scripts))
      diagnostics.push({
        code: 'INVALID_PACKAGE_SCRIPTS',
        severity: 'error',
        message: 'package.json scripts must be an object of string values.',
        source,
      });
    else
      for (const [key, value] of Object.entries(data.scripts as Record<string, unknown>)) {
        if (typeof value !== 'string')
          diagnostics.push({
            code: 'INVALID_PACKAGE_SCRIPTS',
            severity: 'error',
            message: `package.json script "${key}" must be a string.`,
            source,
          });
        else scripts[key] = value;
      }
  }
  let packageManager: string | undefined;
  if (data.packageManager !== undefined) {
    if (typeof data.packageManager !== 'string')
      diagnostics.push({
        code: 'MALFORMED_PACKAGE_MANAGER',
        severity: 'error',
        message: 'package.json packageManager must be a string.',
        source,
      });
    else packageManager = data.packageManager;
  }
  let enginesNode: string | undefined;
  if (data.engines !== undefined) {
    if (typeof data.engines !== 'object' || data.engines === null || Array.isArray(data.engines))
      diagnostics.push({
        code: 'INVALID_ENGINES',
        severity: 'error',
        message: 'package.json engines must be an object.',
        source,
      });
    else if ((data.engines as Record<string, unknown>).node !== undefined) {
      const node = (data.engines as Record<string, unknown>).node;
      if (typeof node !== 'string')
        diagnostics.push({
          code: 'INVALID_NODE_VERSION',
          severity: 'error',
          message: 'package.json engines.node must be a numeric Node selector string.',
          source,
        });
      else enginesNode = node;
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics };
  return {
    ok: true,
    value: {
      scripts,
      ...(packageManager === undefined ? {} : { packageManager }),
      ...(enginesNode === undefined ? {} : { enginesNode }),
    },
    diagnostics,
  };
}
function invalid(source: string, message: string): Resolution<never> {
  return {
    ok: false,
    diagnostics: [{ code: 'INVALID_PACKAGE_JSON', severity: 'error', message, source }],
  };
}
