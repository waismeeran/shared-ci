export function renderDiagnosticAnnotation(diagnostic) {
    const level = diagnostic.severity === 'error' ? 'error' : 'warning';
    const title = annotationEscape(diagnostic.code);
    const message = annotationEscape(diagnostic.message);
    const context = diagnostic.source ? `${annotationEscape(diagnostic.source)}: ` : '';
    return `::${level} title=${title}::${context}${message}`;
}
function annotationEscape(value) {
    return value
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A')
        .replaceAll(':', '%3A')
        .replaceAll(',', '%2C');
}
