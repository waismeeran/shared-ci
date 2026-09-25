import type {
  Diagnostic,
  PackageManagerEvidence,
  PackageManagerName,
  Resolution,
} from '../config/types.js';

const lockManager: Readonly<Record<string, PackageManagerName>> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
};
interface ResolvedManager {
  readonly name: PackageManagerName;
  readonly version?: string;
  readonly source: 'input' | 'package-json' | 'lockfile';
  readonly lockfile: string;
}
export function resolvePackageManager(
  evidence: PackageManagerEvidence,
): Resolution<ResolvedManager> {
  const diagnostics: Diagnostic[] = [];
  const parse = (
    value: string,
    source: string,
  ): { name: PackageManagerName; version?: string } | undefined => {
    if (value === 'auto') return undefined;
    const match = /^(npm|pnpm|yarn)(?:@(.+))?$/.exec(value);
    if (!match) {
      diagnostics.push({
        code: 'UNSUPPORTED_PACKAGE_MANAGER',
        severity: 'error',
        message: `Unsupported package manager declaration "${value}".`,
        source,
      });
      return undefined;
    }
    const name = match[1] as PackageManagerName;
    const version = match[2];
    if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) {
      diagnostics.push({
        code: 'UNSUPPORTED_PACKAGE_MANAGER_VERSION',
        severity: 'error',
        message: `${name} requires an exact numeric version, received "${version}".`,
        source,
      });
      return undefined;
    }
    if (name === 'yarn' && version !== undefined && !version.startsWith('4.'))
      diagnostics.push({
        code: 'UNSUPPORTED_PACKAGE_MANAGER_VERSION',
        severity: 'error',
        message: 'Only Yarn 4 is supported.',
        source,
      });
    if (
      source === 'package.json packageManager' &&
      (name === 'pnpm' || name === 'yarn') &&
      version === undefined
    )
      diagnostics.push({
        code: 'UNSUPPORTED_PACKAGE_MANAGER_VERSION',
        severity: 'error',
        message: `${name} must be pinned to an exact version in package.json packageManager.`,
        source,
      });
    return { name, ...(version === undefined ? {} : { version }) };
  };
  const explicit = evidence.explicit
    ? parse(evidence.explicit, 'package-manager input')
    : undefined;
  const declared = evidence.packageManager
    ? parse(evidence.packageManager, 'package.json packageManager')
    : undefined;
  const unique = [...new Set(evidence.lockfiles.filter((file) => lockManager[file] !== undefined))];
  const npmLock = unique.includes('npm-shrinkwrap.json')
    ? 'npm-shrinkwrap.json'
    : unique.includes('package-lock.json')
      ? 'package-lock.json'
      : undefined;
  const locks = [
    ...(npmLock ? [npmLock] : []),
    ...unique.filter((f) => f !== 'package-lock.json' && f !== 'npm-shrinkwrap.json'),
  ];
  if (!explicit && locks.length > 1)
    diagnostics.push({
      code: 'MULTIPLE_LOCKFILES',
      severity: 'error',
      message: `Multiple package-manager lockfiles were found: ${locks.join(', ')}.`,
      remediation: 'Keep one manager lockfile or select a matching package-manager explicitly.',
    });
  const selected = explicit ?? declared;
  if (selected && declared && selected.name !== declared.name)
    diagnostics.push({
      code: 'PACKAGE_MANAGER_CONFLICT',
      severity: 'error',
      message: `package-manager input selects ${selected.name}, but package.json declares ${declared.name}.`,
    });
  if (selected && locks.length && !locks.some((f) => lockManager[f] === selected.name))
    diagnostics.push({
      code: 'PACKAGE_MANAGER_LOCKFILE_CONFLICT',
      severity: 'error',
      message: `${selected.name} conflicts with lockfile evidence (${locks.join(', ')}).`,
    });
  if (declared && locks.length && !locks.some((f) => lockManager[f] === declared.name))
    diagnostics.push({
      code: 'PACKAGE_MANAGER_LOCKFILE_CONFLICT',
      severity: 'error',
      message: `package.json declares ${declared.name}, but lockfile evidence is ${locks.join(', ')}.`,
    });
  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics };
  const manager =
    selected ??
    (locks.length === 1
      ? { name: lockManager[locks[0]]!, source: 'lockfile' as const }
      : undefined);
  if (!manager)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'PACKAGE_MANAGER_NOT_FOUND',
          severity: 'error',
          message: 'No supported package manager or lockfile was found.',
          remediation: 'Declare packageManager or add a supported lockfile.',
        },
      ],
    };
  const lockfile = locks.find((f) => lockManager[f] === manager.name);
  if (!lockfile)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'PACKAGE_MANAGER_LOCKFILE_MISSING',
          severity: 'error',
          message: `No lockfile was found for ${manager.name}.`,
        },
      ],
    };
  const source = explicit ? 'input' : declared ? 'package-json' : 'lockfile';
  return { ok: true, value: { ...manager, source, lockfile }, diagnostics };
}
