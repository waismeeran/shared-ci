import { appendFile } from 'node:fs/promises';
import { renderCiSummaryMarkdown } from './render-markdown.js';
export async function writeGithubStepSummary(summary, destination) {
    if (!destination)
        return 'UNAVAILABLE';
    await appendFile(destination, renderCiSummaryMarkdown(summary), {
        encoding: 'utf8',
        mode: 0o600,
    });
    return 'WRITTEN';
}
