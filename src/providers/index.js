import { buildClaudeCommand } from './claude.js';
import { buildCodexCommand } from './codex.js';
import { buildGeminiCommand } from './gemini.js';

export function buildProviderCommand(job) {
  if (job.provider === 'claude') {
    return buildClaudeCommand(job);
  }

  if (job.provider === 'codex') {
    return buildCodexCommand(job);
  }

  if (job.provider === 'gemini') {
    return buildGeminiCommand(job);
  }

  throw new Error(`Unsupported provider: ${job.provider}`);
}
