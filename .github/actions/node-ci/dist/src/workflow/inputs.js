/** Converts the scalar workflow_call contract to the resolver's existing configuration. */
export function toCiConfig(inputs) {
    return {
        'node-version': inputs['node-version'] ?? 'auto',
        'package-manager': inputs['package-manager'] ?? 'auto',
        'working-directory': inputs['working-directory'] ?? '.',
        lint: inputs.lint ?? 'auto',
        typecheck: inputs.typecheck ?? 'auto',
        unit: inputs.unit ?? 'auto',
        integration: inputs.integration ?? 'auto',
        build: inputs.build ?? 'auto',
        e2e: inputs.e2e ?? 'false',
        'lint-command': optional(inputs['lint-command']),
        'typecheck-command': optional(inputs['typecheck-command']),
        'unit-command': optional(inputs['unit-command']),
        'integration-command': optional(inputs['integration-command']),
        'build-command': optional(inputs['build-command']),
        'e2e-command': optional(inputs['e2e-command']),
    };
}
function optional(value) {
    return value === undefined || value === '' ? undefined : value;
}
