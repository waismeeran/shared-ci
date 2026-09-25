import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { capabilityNames } from '../src/config/types.js';
import { createCiActionState } from '../src/reporting/summary-model.js';
export async function readActionState(path) {
    let value;
    try {
        value = JSON.parse(await readFile(path, 'utf8'));
    }
    catch (error) {
        if (isMissingFile(error))
            return createCiActionState();
        throw error;
    }
    if (!isActionState(value))
        throw new Error('Shared CI action state file has an unsupported shape.');
    return value;
}
export async function writeActionState(path, state) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
}
function isMissingFile(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
function isActionState(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const state = value;
    return (state.version === 1 &&
        ['PASSED', 'FAILED', 'NOT_REACHED'].includes(state.preflightStatus ?? '') &&
        (state.projectDirectory === undefined || typeof state.projectDirectory === 'string') &&
        isDiagnostics(state.diagnostics) &&
        (state.plan === undefined || isPlan(state.plan)) &&
        (state.setup === undefined || isSetup(state.setup)) &&
        (state.nodeSetupStatus === undefined ||
            ['PASSED', 'FAILED', 'TIMED_OUT', 'IN_PROGRESS', 'NOT_REACHED'].includes(state.nodeSetupStatus)) &&
        (state.capabilities === undefined ||
            (Array.isArray(state.capabilities) && state.capabilities.every(isCapability))) &&
        (state.aggregate === undefined || ['PASSED', 'FAILED'].includes(state.aggregate)) &&
        (state.packageCache === undefined || isPackageCache(state.packageCache)));
}
function isPackageCache(value) {
    return (isRecord(value) &&
        ['NOT_REACHED', 'NOT_ATTEMPTED', 'MISS', 'HIT', 'UNAVAILABLE'].includes(String(value.status)) &&
        (value.manager === undefined || ['npm', 'pnpm', 'yarn'].includes(String(value.manager))) &&
        (value.managerVersion === undefined || typeof value.managerVersion === 'string') &&
        (value.keyIdentity === undefined || typeof value.keyIdentity === 'string') &&
        (value.saveStatus === undefined ||
            ['NOT_REACHED', 'NOT_NEEDED', 'SAVED', 'UNAVAILABLE'].includes(String(value.saveStatus))));
}
function isDiagnostics(value) {
    return (Array.isArray(value) &&
        value.every((item) => isRecord(item) &&
            typeof item.code === 'string' &&
            ['error', 'warning'].includes(String(item.severity)) &&
            typeof item.message === 'string' &&
            (item.source === undefined || typeof item.source === 'string') &&
            (item.remediation === undefined || typeof item.remediation === 'string')));
}
function isPlan(value) {
    if (!isRecord(value))
        return false;
    const capabilities = value.capabilities;
    return (isRecord(value.project) &&
        typeof value.project.workingDirectory === 'string' &&
        isRecord(value.node) &&
        typeof value.node.selector === 'string' &&
        typeof value.node.source === 'string' &&
        isRecord(value.packageManager) &&
        typeof value.packageManager.name === 'string' &&
        typeof value.packageManager.source === 'string' &&
        typeof value.packageManager.lockfile === 'string' &&
        isRecord(capabilities) &&
        capabilityNames.every((name) => isRecord(capabilities[name])) &&
        isDiagnostics(value.diagnostics));
}
function isSetup(value) {
    return (isRecord(value) &&
        ['PASSED', 'FAILED', 'TIMED_OUT', 'IN_PROGRESS', 'NOT_REACHED'].includes(String(value.status)) &&
        isDiagnostics(value.diagnostics) &&
        (value.currentStage === undefined ||
            ['runtime-verification', 'package-manager-preparation', 'dependency-installation'].includes(String(value.currentStage))) &&
        (value.preparation === undefined ||
            (isRecord(value.preparation) && isDiagnostics(value.preparation.diagnostics))) &&
        (value.installation === undefined || isRecord(value.installation)));
}
function isCapability(value) {
    return (isRecord(value) &&
        capabilityNames.includes(value.capability) &&
        ['DETECTED', 'OVERRIDDEN', 'ABSENT', 'DISABLED', 'NOT_RESOLVED'].includes(String(value.discoveryState)) &&
        ['PASSED', 'FAILED', 'TIMED_OUT', 'SKIPPED', 'NOT_EXECUTED'].includes(String(value.executionStatus)) &&
        (value.source === undefined || typeof value.source === 'string') &&
        (value.command === undefined || typeof value.command === 'string') &&
        (value.skipReason === undefined ||
            ['ABSENT', 'DISABLED', 'PREREQUISITE_FAILED', 'NOT_REACHED'].includes(String(value.skipReason))));
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
