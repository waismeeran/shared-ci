import { capabilityNames } from '../config/types.js';
export function createCiActionState() {
    return {
        version: 1,
        preflightStatus: 'NOT_REACHED',
        packageCache: { status: 'NOT_REACHED' },
        diagnostics: [],
    };
}
export function capabilityReportRows(plan, result) {
    return capabilityNames.map((name) => {
        const resolved = plan?.capabilities[name];
        const execution = result?.capabilities?.[name];
        const source = resolved?.source === 'override'
            ? 'workflow input'
            : resolved?.source === 'package-script'
                ? `package.json:scripts.${resolved.command?.value ?? ''}`
                : resolved?.state === 'ABSENT'
                    ? 'no matching script'
                    : resolved?.state === 'DISABLED'
                        ? 'workflow input'
                        : undefined;
        if (execution)
            return fromExecution(execution, source);
        return {
            capability: name,
            discoveryState: resolved?.state ?? 'NOT_RESOLVED',
            executionStatus: 'NOT_EXECUTED',
            ...(source ? { source } : {}),
            ...(resolved?.command?.value ? { command: displayCommand(plan, name) } : {}),
            ...(resolved ? { skipReason: 'NOT_REACHED' } : {}),
        };
    });
}
function displayCommand(plan, name) {
    const command = plan.capabilities[name].command;
    if (!command)
        return '';
    if (command.kind === 'opaque')
        return command.value;
    switch (plan.packageManager.name) {
        case 'npm':
            return `npm run ${command.value}`;
        case 'pnpm':
            return `pnpm run ${command.value}`;
        case 'yarn':
            return `yarn run ${command.value}`;
    }
}
function fromExecution(value, source) {
    return {
        capability: value.capability,
        discoveryState: value.discoveryState,
        executionStatus: value.executionStatus,
        ...(source ? { source } : {}),
        ...(value.command ? { command: value.command } : {}),
        ...(value.skipReason ? { skipReason: value.skipReason } : {}),
        durationMs: value.durationMs,
        exitCode: value.exitCode,
        ...(value.signal ? { signal: value.signal } : {}),
        ...(value.error ? { error: value.error } : {}),
    };
}
export function buildCiSummary(state) {
    const allDiagnostics = [
        ...state.diagnostics,
        ...(state.plan?.diagnostics ?? []),
        ...(state.setup?.diagnostics ?? []),
    ];
    const diagnostics = [
        ...new Map(allDiagnostics.map((diagnostic) => [
            [
                diagnostic.severity,
                diagnostic.code,
                diagnostic.source ?? '',
                diagnostic.message,
                diagnostic.remediation ?? '',
            ].join('\u0000'),
            diagnostic,
        ])).values(),
    ];
    const setup = state.setup ?? { status: 'NOT_REACHED', diagnostics: [] };
    const capabilities = state.capabilities ?? capabilityReportRows(state.plan);
    const failed = state.preflightStatus === 'FAILED' ||
        state.setup?.status === 'FAILED' ||
        state.setup?.status === 'TIMED_OUT' ||
        state.nodeSetupStatus === 'FAILED' ||
        state.nodeSetupStatus === 'TIMED_OUT' ||
        state.aggregate === 'FAILED' ||
        capabilities.some((capability) => capability.executionStatus === 'FAILED' || capability.executionStatus === 'TIMED_OUT') ||
        diagnostics.some((diagnostic) => diagnostic.severity === 'error');
    const result = failed
        ? 'FAIL'
        : state.preflightStatus === 'PASSED' &&
            state.nodeSetupStatus === 'PASSED' &&
            state.setup?.status === 'PASSED' &&
            state.aggregate === 'PASSED'
            ? 'PASS'
            : 'INCOMPLETE';
    return {
        result,
        ...(state.projectDirectory ? { projectDirectory: state.projectDirectory } : {}),
        ...(state.plan ? { node: state.plan.node, packageManager: state.plan.packageManager } : {}),
        preflightStatus: state.preflightStatus,
        nodeSetupStatus: state.nodeSetupStatus ?? 'NOT_REACHED',
        setup,
        capabilities,
        diagnostics,
        packageCache: state.packageCache ?? { status: 'NOT_REACHED' },
    };
}
