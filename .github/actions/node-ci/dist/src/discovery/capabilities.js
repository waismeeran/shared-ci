const names = [
    'lint',
    'typecheck',
    'unit',
    'integration',
    'build',
    'e2e',
];
export function resolveCapabilities(config, manifest) {
    const diagnostics = [];
    const result = {};
    for (const name of names) {
        const mode = name === 'e2e' ? (config.e2e ?? 'false') : (config[name] ?? 'auto');
        const command = config[`${name}-command`];
        if (mode === 'false') {
            result[name] = { mode, state: 'DISABLED' };
            continue;
        }
        if (typeof command === 'string' && command.trim().length > 0) {
            result[name] = {
                mode: mode,
                state: 'OVERRIDDEN',
                source: 'override',
                command: { kind: 'opaque', value: command },
            };
            continue;
        }
        const scripts = name === 'unit'
            ? ['test:unit', 'test']
            : name === 'lint'
                ? ['lint']
                : name === 'typecheck'
                    ? ['typecheck']
                    : name === 'integration'
                        ? ['test:integration']
                        : name === 'build'
                            ? ['build']
                            : ['test:e2e'];
        const script = scripts.find((candidate) => Object.hasOwn(manifest.scripts, candidate));
        if (script) {
            result[name] = {
                mode: mode,
                state: 'DETECTED',
                source: 'package-script',
                command: { kind: 'package-script', value: script },
            };
            continue;
        }
        if (mode === 'true')
            diagnostics.push({
                code: 'REQUIRED_CAPABILITY_MISSING',
                severity: 'error',
                message: `Capability "${name}" is required but no command override or documented package script was found.`,
                source: name,
                remediation: `Add ${name}-command or the documented package.json script.`,
            });
        result[name] = { mode: mode, state: 'ABSENT' };
    }
    return diagnostics.length ? { ok: false, diagnostics } : { ok: true, value: result, diagnostics };
}
