import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectStatus,
  formatList,
  readLatestRunLogs,
} from '../src/status.js';

test('formatList renders jobs and next runs', () => {
  const output = formatList(
    {
      timezone: 'Asia/Seoul',
      jobs: [
        { id: 'claude-0600', provider: 'claude', schedule: '0 6 * * *', enabled: true },
      ],
    },
    { count: 1, now: new Date('2026-05-05T20:59:00Z') },
  );

  assert.match(output, /claude-0600/);
  assert.match(output, /provider: claude/);
  assert.match(output, /next:/);
});

test('readLatestRunLogs returns latest JSONL entries per job', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-status-'));
  await writeFile(
    path.join(dir, 'runs-2026-05-05.jsonl'),
    [
      JSON.stringify({ jobId: 'a', status: 'failed', finishedAt: '2026-05-05T01:00:00Z' }),
      JSON.stringify({ jobId: 'a', status: 'success', finishedAt: '2026-05-05T02:00:00Z' }),
      JSON.stringify({ jobId: 'b', status: 'timeout', finishedAt: '2026-05-05T03:00:00Z' }),
      '',
    ].join('\n'),
  );

  const latest = await readLatestRunLogs(dir);

  assert.equal(latest.get('a').status, 'success');
  assert.equal(latest.get('b').status, 'timeout');
});

test('collectStatus combines jobs, plist existence, and latest logs without launchctl', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-status-'));
  const launchAgentsDir = path.join(dir, 'LaunchAgents');
  const logDir = path.join(dir, 'logs');
  await import('node:fs/promises').then(({ mkdir }) => Promise.all([
    mkdir(launchAgentsDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
  ]));
  await writeFile(
    path.join(launchAgentsDir, 'com.local.cli-heartbeat-scheduler.claude-0600.plist'),
    'plist',
  );
  await writeFile(
    path.join(logDir, 'runs-2026-05-05.jsonl'),
    `${JSON.stringify({ jobId: 'claude-0600', status: 'success', finishedAt: '2026-05-05T02:00:00Z' })}\n`,
  );

  const status = await collectStatus(
    {
      logDir,
      jobs: [{ id: 'claude-0600', provider: 'claude', schedule: '0 6 * * *', enabled: true }],
    },
    { launchAgentsDir, includeLaunchctl: false },
  );

  assert.equal(status[0].registered, true);
  assert.equal(status[0].lastRun.status, 'success');
});

test('collectStatus reports systemd unit registration on linux', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-status-linux-'));
  const systemdUserDir = path.join(dir, 'units');
  const logDir = path.join(dir, 'logs');
  await import('node:fs/promises').then(({ mkdir }) => Promise.all([
    mkdir(systemdUserDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
  ]));
  await writeFile(
    path.join(systemdUserDir, 'cli-heartbeat-scheduler-claude-0600.service'),
    'service',
  );
  await writeFile(
    path.join(systemdUserDir, 'cli-heartbeat-scheduler-claude-0600.timer'),
    'timer',
  );
  await writeFile(
    path.join(logDir, 'runs-2026-05-05.jsonl'),
    `${JSON.stringify({ jobId: 'claude-0600', status: 'success', finishedAt: '2026-05-05T02:00:00Z' })}\n`,
  );

  const status = await collectStatus(
    {
      logDir,
      jobs: [{ id: 'claude-0600', provider: 'claude', schedule: '0 6 * * *', enabled: true }],
    },
    {
      platform: 'linux',
      systemdUserDir,
      includeSystemctl: false,
    },
  );

  assert.equal(status[0].registered, true);
  assert.equal(status[0].unitName, 'cli-heartbeat-scheduler-claude-0600');
  assert.equal(status[0].lastRun.status, 'success');
});

test('collectStatus combines Windows task status and latest logs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-status-win-'));
  const logDir = path.join(dir, 'logs');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(logDir, { recursive: true }));
  await writeFile(
    path.join(logDir, 'runs-2026-05-05.jsonl'),
    `${JSON.stringify({ jobId: 'claude-0600', status: 'success', finishedAt: '2026-05-05T02:00:00Z' })}\n`,
  );

  const status = await collectStatus(
    {
      logDir,
      jobs: [{ id: 'claude-0600', provider: 'claude', schedule: '0 6 * * *', enabled: true }],
    },
    {
      platform: 'win32',
      taskRows: [
        {
          TaskName: 'CLI Heartbeat Scheduler claude-0600',
          State: 'Ready',
          LastTaskResult: 0,
        },
      ],
    },
  );

  assert.equal(status[0].registered, true);
  assert.equal(status[0].taskName, 'CLI Heartbeat Scheduler claude-0600');
  assert.equal(status[0].taskState, 'Ready');
  assert.equal(status[0].lastRun.status, 'success');
});
