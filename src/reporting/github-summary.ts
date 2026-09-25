import { appendFile } from 'node:fs/promises';
import type { CiSummaryModel } from './types.js';
import { renderCiSummaryMarkdown } from './render-markdown.js';

export async function writeGithubStepSummary(
  summary: CiSummaryModel,
  destination: string | undefined,
): Promise<'WRITTEN' | 'UNAVAILABLE'> {
  if (!destination) return 'UNAVAILABLE';
  await appendFile(destination, renderCiSummaryMarkdown(summary), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return 'WRITTEN';
}
