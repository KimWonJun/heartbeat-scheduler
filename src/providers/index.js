import { buildAntigravityCommand } from './antigravity.js';
import { buildClaudeCommand } from './claude.js';
import { buildCodexCommand } from './codex.js';

export function buildProviderCommand(job) {
  if (job.provider === 'claude') {
    return buildClaudeCommand(job);
  }

  if (job.provider === 'codex') {
    return buildCodexCommand(job);
  }

  if (job.provider === 'antigravity') {
    return buildAntigravityCommand(job);
  }

  throw new Error(`Unsupported provider: ${job.provider}`);
}
