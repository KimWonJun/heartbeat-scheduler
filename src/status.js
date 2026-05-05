import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { desiredLaunchAgents } from './platform/macos-launch-agent.js';
import { nextRuns } from './scheduler.js';

export function formatList(config, options = {}) {
  const count = Number(options.count || 1);
  const now = options.now || new Date();
  const lines = [];

  for (const job of config.jobs.filter((candidate) => candidate.enabled !== false)) {
    const runs = nextRuns(job.schedule, config.timezone || 'Asia/Seoul', count, now);
    lines.push(`${job.id}`);
    lines.push(`  provider: ${job.provider}`);
    lines.push(`  schedule: ${job.schedule}`);
    lines.push(`  recurrence: ${job.recurrence?.type || 'unknown'}`);
    for (const run of runs) {
      lines.push(`  next: ${run.toISOString()}`);
    }
  }

  return lines.join('\n');
}

export async function readLatestRunLogs(logDir) {
  const latest = new Map();
  let entries;

  try {
    entries = await readdir(logDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return latest;
    }
    throw error;
  }

  const logFiles = entries
    .filter((entry) => /^runs-\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry))
    .sort();

  for (const file of logFiles) {
    const raw = await readFile(path.join(logDir, file), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      const event = JSON.parse(line);
      const previous = latest.get(event.jobId);
      if (!previous || String(event.finishedAt || '') >= String(previous.finishedAt || '')) {
        latest.set(event.jobId, event);
      }
    }
  }

  return latest;
}

export async function collectStatus(config, options = {}) {
  const latestLogs = await readLatestRunLogs(config.logDir);
  const agents = desiredLaunchAgents(config, options);

  return Promise.all(agents.map(async (agent) => {
    const registered = await fileExists(agent.plistPath);
    return {
      jobId: agent.job.id,
      provider: agent.job.provider,
      label: agent.label,
      plistPath: agent.plistPath,
      registered,
      launchctl: options.includeLaunchctl === false ? undefined : printLaunchctl(agent.label),
      lastRun: latestLogs.get(agent.job.id),
    };
  }));
}

export function formatStatus(statuses) {
  return statuses.map((item) => [
    item.jobId,
    `  provider: ${item.provider}`,
    `  registered: ${item.registered ? 'yes' : 'no'}`,
    `  label: ${item.label}`,
    item.lastRun ? `  last: ${item.lastRun.status} at ${item.lastRun.finishedAt}` : '  last: none',
  ].join('\n')).join('\n');
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function printLaunchctl(label) {
  if (process.platform !== 'darwin') {
    return { available: false, output: 'launchctl is only available on macOS' };
  }

  const result = spawnSync('launchctl', ['print', `gui/${process.getuid()}/${label}`], {
    stdio: 'pipe',
    encoding: 'utf8',
  });

  return {
    available: true,
    status: result.status,
    output: result.stdout || result.stderr,
  };
}
