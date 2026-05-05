export function buildCodexCommand(job) {
  if (job.commandArgs) {
    return {
      file: job.command || process.env.CLI_HEARTBEAT_CODEX_BIN || 'codex',
      args: job.commandArgs,
    };
  }

  return {
    file: job.command || process.env.CLI_HEARTBEAT_CODEX_BIN || 'codex',
    args: [
      '--ask-for-approval',
      'never',
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      ...(job.extraArgs || []),
      job.prompt,
    ],
  };
}
