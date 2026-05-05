export function buildClaudeCommand(job) {
  if (job.commandArgs) {
    return {
      file: job.command || process.env.CLI_HEARTBEAT_CLAUDE_BIN || 'claude',
      args: job.commandArgs,
    };
  }

  return {
    file: job.command || process.env.CLI_HEARTBEAT_CLAUDE_BIN || 'claude',
    args: [
      '-p',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
      '--tools',
      '',
      '--output-format',
      'text',
      ...(job.extraArgs || []),
      job.prompt,
    ],
  };
}
