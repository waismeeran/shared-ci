import { createHash } from 'node:crypto';
import { isAbsolute, resolve, sep } from 'node:path';
/** Pure deterministic cache planning; IO and manager path discovery happen elsewhere. */
export function resolvePackageManagerCachePlan(plan, inputs) {
    const cachePath = resolve(inputs.cachePath);
    if (!isAbsolute(inputs.cachePath) || /[\r\n]/.test(inputs.cachePath))
        throw new Error('Package-manager cache path must be a single-line absolute path.');
    if (cachePath.split(sep).some((part) => part.toLowerCase() === 'node_modules'))
        throw new Error('node_modules cannot be used as a package-manager cache target.');
    if (!inputs.managerVersion.trim() || /[\r\n]/.test(inputs.managerVersion))
        throw new Error('Resolved package-manager version must be a non-empty single-line value.');
    if (!/^[a-zA-Z0-9._-]+$/.test(inputs.platform) || !/^[a-zA-Z0-9._-]+$/.test(inputs.architecture))
        throw new Error('Cache platform and architecture must use safe identifier characters.');
    const lockfileHash = createHash('sha256').update(inputs.lockfileContents).digest('hex');
    const manager = plan.packageManager.name;
    const primaryKey = [
        'shared-ci-pm-v1',
        inputs.platform.toLowerCase(),
        inputs.architecture.toLowerCase(),
        manager,
        inputs.managerVersion,
        lockfileHash,
    ].join('-');
    return {
        enabled: true,
        manager,
        managerVersion: inputs.managerVersion,
        lockfile: plan.packageManager.lockfile,
        lockfileHash,
        cachePath,
        primaryKey,
        restoreKeys: [],
        keyIdentity: lockfileHash.slice(0, 12),
    };
}
