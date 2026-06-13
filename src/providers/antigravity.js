export function buildAntigravityCommand(job) {
  if (job.commandArgs) {
    return {
      file: job.command || process.env.CLI_HEARTBEAT_ANTIGRAVITY_BIN || 'agy',
      args: job.commandArgs,
    };
  }

  return {
    file: job.command || process.env.CLI_HEARTBEAT_ANTIGRAVITY_BIN || 'agy',
    args: [
      ...(job.extraArgs || []),
      '--sandbox',
      '--print',
      job.prompt,
    ],
  };
}
