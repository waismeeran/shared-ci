const capabilities = ['lint', 'typecheck', 'unit', 'integration', 'build', 'e2e'];
export function validateConfig(config) {
    const diagnostics = [];
    const mode = (name) => name === 'e2e' ? (config.e2e ?? 'false') : (config[name] ?? 'auto');
    for (const name of capabilities) {
        const value = mode(name);
        if (!['auto', 'true', 'false'].includes(value))
            diagnostics.push({
                code: 'INVALID_CAPABILITY_MODE',
                severity: 'error',
                message: `Capability "${name}" must be auto, true, or false.`,
                source: name,
            });
        const command = config[`${name}-command`];
        if (command !== undefined && (typeof command !== 'string' || command.trim().length === 0))
            diagnostics.push({
                code: 'INVALID_COMMAND_OVERRIDE',
                severity: 'error',
                message: `The ${name}-command override must be a non-empty string.`,
                source: `${name}-command`,
            });
        if (command !== undefined && value === 'false')
            diagnostics.push({
                code: 'DISABLED_CAPABILITY_HAS_OVERRIDE',
                severity: 'error',
                message: `Capability "${name}" is disabled but also defines "${name}-command".`,
                source: `${name}-command`,
                remediation: `Remove the command override or change "${name}" from "false".`,
            });
    }
    if (config['working-directory'] !== undefined && !config['working-directory'].trim())
        diagnostics.push({
            code: 'INVALID_WORKING_DIRECTORY',
            severity: 'error',
            message: 'working-directory must be a non-empty relative path.',
        });
    if (config['package-manager'] !== undefined &&
        !['auto', 'npm', 'pnpm', 'yarn'].includes(config['package-manager']))
        diagnostics.push({
            code: 'UNSUPPORTED_PACKAGE_MANAGER',
            severity: 'error',
            message: `Unsupported package-manager value "${config['package-manager']}".`,
        });
    return diagnostics;
}
