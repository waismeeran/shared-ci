import { access, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parsePackageJson } from './package-json.js';
import { resolveCiPlan } from './plan.js';
const lockfiles = [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock',
];
export async function inspectProject(projectRoot, config = {}) {
    const requested = config['working-directory'] ?? '.';
    if (isAbsolute(requested))
        return fail({
            code: 'INVALID_WORKING_DIRECTORY',
            severity: 'error',
            message: 'working-directory must be relative to the project root.',
            source: requested,
        });
    const root = resolve(projectRoot);
    const directory = resolve(root, requested);
    const rel = relative(root, directory);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        return fail({
            code: 'INVALID_WORKING_DIRECTORY',
            severity: 'error',
            message: 'working-directory cannot escape the project root.',
            source: requested,
        });
    try {
        const [realRoot, realDirectory] = await Promise.all([realpath(root), realpath(directory)]);
        const realRelative = relative(realRoot, realDirectory);
        if (realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
            return fail({
                code: 'INVALID_WORKING_DIRECTORY',
                severity: 'error',
                message: 'working-directory resolves outside the project root.',
                source: requested,
            });
        }
    }
    catch {
        // The ordinary directory check below reports a missing project path.
    }
    try {
        if (!(await stat(directory)).isDirectory())
            return fail({
                code: 'PROJECT_DIRECTORY_NOT_FOUND',
                severity: 'error',
                message: `Project directory "${requested}" is not a directory.`,
                source: requested,
            });
    }
    catch {
        return fail({
            code: 'PROJECT_DIRECTORY_NOT_FOUND',
            severity: 'error',
            message: `Project directory "${requested}" does not exist.`,
            source: requested,
        });
    }
    let manifestText;
    try {
        manifestText = await readFile(resolve(directory, 'package.json'), 'utf8');
    }
    catch {
        return fail({
            code: 'PACKAGE_JSON_NOT_FOUND',
            severity: 'error',
            message: `No package.json exists in "${requested}".`,
            source: resolve(directory, 'package.json'),
        });
    }
    const manifest = parsePackageJson(manifestText);
    if (!manifest.ok)
        return manifest;
    const present = [];
    for (const filename of lockfiles) {
        try {
            await access(resolve(directory, filename), constants.F_OK);
            present.push(filename);
        }
        catch {
            /* absent evidence */
        }
    }
    const [nvmrc, nodeVersionFile] = await Promise.all([
        optionalText(resolve(directory, '.nvmrc')),
        optionalText(resolve(directory, '.node-version')),
    ]);
    return resolveCiPlan(config, {
        workingDirectory: rel || '.',
        manifest: manifest.value,
        node: {
            ...(nvmrc === undefined ? {} : { nvmrc }),
            ...(nodeVersionFile === undefined ? {} : { nodeVersionFile }),
            ...(manifest.value.enginesNode === undefined
                ? {}
                : { enginesNode: manifest.value.enginesNode }),
        },
        lockfiles: present,
    });
}
async function optionalText(path) {
    try {
        return (await readFile(path, 'utf8')).trim();
    }
    catch {
        return undefined;
    }
}
function fail(diagnostic) {
    return { ok: false, diagnostics: [diagnostic] };
}
