export function renderCiSummaryMarkdown(summary) {
    const rows = summary.capabilities.map(renderCapabilityRow).join('\n');
    const diagnostics = summary.diagnostics.length
        ? summary.diagnostics.map(renderDiagnostic).join('\n\n')
        : 'No configuration or setup diagnostics.';
    const environment = [
        '| Item | Value | Source |',
        '| --- | --- | --- |',
        `| Project | ${cell(summary.projectDirectory)} | ${summary.projectDirectory ? 'resolved project' : 'Not resolved'} |`,
        `| Node | ${summary.node ? code(summary.node.selector) : 'Not resolved'} | ${summary.node?.source ?? 'Not resolved'} |`,
        `| Package manager | ${summary.packageManager ? code(`${summary.packageManager.name}${(summary.packageManager.version ?? summary.setup.preparation?.actualVersion) ? `@${summary.packageManager.version ?? summary.setup.preparation?.actualVersion}` : ''}`) : 'Not resolved'} | ${summary.packageManager?.source ?? 'Not resolved'} |`,
        `| Lockfile | ${summary.packageManager ? code(summary.packageManager.lockfile) : 'Not resolved'} | — |`,
    ].join('\n');
    const setupRows = renderSetup(summary);
    const failureNote = summary.result === 'FAIL' ? '\n\nSee the relevant step log group for command output.' : '';
    return [
        '# Shared CI',
        '',
        `**Result:** ${summary.result}`,
        '',
        '## Environment / project',
        '',
        environment,
        '',
        '## Setup / installation',
        '',
        '| Stage | Result | Details |',
        '| --- | --- | --- |',
        setupRows,
        '',
        '## Package-manager cache',
        '',
        renderPackageCache(summary),
        '',
        '## Capabilities',
        '',
        '| Capability | Discovery | Source | Command | Execution | Reason |',
        '| --- | --- | --- | --- | --- | --- |',
        rows,
        '',
        '## Diagnostics',
        '',
        diagnostics,
        failureNote,
        '',
    ].join('\n');
}
function renderPackageCache(summary) {
    const cache = summary.packageCache;
    const manager = cache.manager
        ? `${cache.manager}${cache.managerVersion ? `@${cache.managerVersion}` : ''}`
        : 'Not resolved';
    const save = cache.saveStatus ? `; save ${cache.saveStatus}` : '';
    return [
        '| Result | Manager | Data | Lock identity |',
        '| --- | --- | --- | --- |',
        `| ${cache.status}${save} | ${code(manager)} | package-manager store/download data | ${cache.keyIdentity ? code(cache.keyIdentity) : '—'} |`,
    ].join('\n');
}
function renderSetup(summary) {
    const setup = summary.setup;
    const rows = [`| Preflight | ${summary.preflightStatus} | Configuration resolution |`];
    rows.push(`| actions/setup-node | ${summary.nodeSetupStatus} | Resolved Node selector passed to the pinned setup action |`);
    if (setup.status === 'NOT_REACHED') {
        rows.push('| Runtime verification | NOT_REACHED | Setup did not begin |');
        rows.push('| Package-manager preparation | NOT_REACHED | Setup did not begin |');
        rows.push('| Immutable installation | NOT_REACHED | Installation did not begin |');
        return rows.join('\n');
    }
    const runtimeDetails = setup.runtimeVerification
        ? `${setup.runtimeVerification.actualVersion} (${setup.runtimeVerification.requirement.source})`
        : setup.currentStage === 'runtime-verification'
            ? 'In progress'
            : 'Not reached';
    const preparationDetails = setup.preparation
        ? `${setup.preparation.stage}; ${setup.preparation.packageManager}${setup.preparation.actualVersion ? `@${setup.preparation.actualVersion}` : ''}`
        : setup.failedAt === 'package-manager-preparation'
            ? 'Failed before a preparation result was returned'
            : setup.currentStage === 'package-manager-preparation'
                ? 'In progress'
                : 'Not reached';
    const installationDetails = setup.installation
        ? `${setup.installation.packageManager}${setup.installation.version ? `@${setup.installation.version}` : ''}; ${setup.installation.lockfile}`
        : setup.failedAt === 'dependency-installation'
            ? 'Installation failed'
            : setup.currentStage === 'dependency-installation'
                ? 'In progress'
                : 'Not reached';
    rows.push(`| Runtime verification | ${setup.runtimeVerification?.status ?? (setup.failedAt === 'runtime-verification' ? setup.status : 'NOT_REACHED')} | ${cell(runtimeDetails)} |`);
    rows.push(`| Package-manager preparation | ${setup.preparation?.status ?? (setup.currentStage === 'package-manager-preparation' || setup.failedAt === 'package-manager-preparation' ? setup.status : 'NOT_REACHED')} | ${cell(preparationDetails)} |`);
    rows.push(`| Immutable installation | ${setup.installation?.status ?? (setup.currentStage === 'dependency-installation' || setup.failedAt === 'dependency-installation' ? setup.status : 'NOT_REACHED')} | ${cell(installationDetails)} |`);
    return rows.join('\n');
}
function renderCapabilityRow(capability) {
    const reasons = [
        capability.skipReason,
        capability.error ? `${capability.error.code}: ${capability.error.message}` : undefined,
    ].filter((value) => Boolean(value));
    return `| ${capability.capability} | ${capability.discoveryState} | ${cell(capability.source)} | ${capability.command ? code(capability.command) : '—'} | ${capability.executionStatus} | ${reasons.length ? cell(reasons.join('; ')) : '—'} |`;
}
function renderDiagnostic(diagnostic) {
    const label = diagnostic.severity === 'error' ? 'ERROR' : 'WARNING';
    const context = diagnostic.source ? `\n\nContext: ${code(diagnostic.source)}` : '';
    const remediation = diagnostic.remediation ? `\n\nFix: ${text(diagnostic.remediation)}` : '';
    return `**${label} — ${text(diagnostic.code)}**\n\n${text(diagnostic.message)}${context}${remediation}`;
}
function cell(value) {
    return value ? escapeTable(value) : '—';
}
function code(value) {
    const safe = value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('|', '&#124;')
        .replaceAll('`', '&#96;')
        .replaceAll('\r', ' ')
        .replaceAll('\n', ' ');
    return `\`${safe}\``;
}
function text(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('`', '\\`')
        .replaceAll('|', '\\|')
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n')
        .replaceAll('\n', '<br>');
}
function escapeTable(value) {
    return text(value);
}
