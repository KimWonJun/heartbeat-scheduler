export function buildGeminiCommand(job) {
  if (job.commandArgs) {
    return {
      file: job.command || process.env.CLI_HEARTBEAT_GEMINI_BIN || 'gemini',
      args: job.commandArgs,
    };
  }

  return {
    file: job.command || process.env.CLI_HEARTBEAT_GEMINI_BIN || 'gemini',
    args: [
      ...(job.extraArgs || []),
      '-p',
      job.prompt,
      '--approval-mode',
      'plan',
      '--output-format',
      'text',
    ],
  };
}
