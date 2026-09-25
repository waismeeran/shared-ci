export function parsePackageJson(text, source = 'package.json') {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
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
    const data = raw;
    const diagnostics = [];
    const scripts = {};
    if (data.scripts !== undefined) {
        if (typeof data.scripts !== 'object' || data.scripts === null || Array.isArray(data.scripts))
            diagnostics.push({
                code: 'INVALID_PACKAGE_SCRIPTS',
                severity: 'error',
                message: 'package.json scripts must be an object of string values.',
                source,
            });
        else
            for (const [key, value] of Object.entries(data.scripts)) {
                if (typeof value !== 'string')
                    diagnostics.push({
                        code: 'INVALID_PACKAGE_SCRIPTS',
                        severity: 'error',
                        message: `package.json script "${key}" must be a string.`,
                        source,
                    });
                else
                    scripts[key] = value;
            }
    }
    let packageManager;
    if (data.packageManager !== undefined) {
        if (typeof data.packageManager !== 'string')
            diagnostics.push({
                code: 'MALFORMED_PACKAGE_MANAGER',
                severity: 'error',
                message: 'package.json packageManager must be a string.',
                source,
            });
        else
            packageManager = data.packageManager;
    }
    let enginesNode;
    if (data.engines !== undefined) {
        if (typeof data.engines !== 'object' || data.engines === null || Array.isArray(data.engines))
            diagnostics.push({
                code: 'INVALID_ENGINES',
                severity: 'error',
                message: 'package.json engines must be an object.',
                source,
            });
        else if (data.engines.node !== undefined) {
            const node = data.engines.node;
            if (typeof node !== 'string')
                diagnostics.push({
                    code: 'INVALID_NODE_VERSION',
                    severity: 'error',
                    message: 'package.json engines.node must be a numeric Node selector string.',
                    source,
                });
            else
                enginesNode = node;
        }
    }
    if (diagnostics.some((d) => d.severity === 'error'))
        return { ok: false, diagnostics };
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
function invalid(source, message) {
    return {
        ok: false,
        diagnostics: [{ code: 'INVALID_PACKAGE_JSON', severity: 'error', message, source }],
    };
}
