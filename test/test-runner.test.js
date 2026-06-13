import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDryProbeConfig,
  runDryProbe,
  runRealSmokeTest,
} from '../src/test-runner.js';

test('buildDryProbeConfig creates fake jobs for each selected agent', () => {
  const config = buildDryProbeConfig(['claude', 'antigravity'], {
    rootDir: '/tmp/root',
    now: new Date('2026-05-05T00:00:00Z'),
  });

  assert.deepEqual(config.jobs.map((job) => job.id), ['dry-probe-claude', 'dry-probe-antigravity']);
  assert.equal(config.jobs[0].command, process.execPath);
  assert.match(config.jobs[0].commandArgs.at(-1), /dry-probe-ok/);
});

test('runDryProbe uses an isolated LaunchAgents directory on darwin', async () => {
  const result = await runDryProbe(['claude'], {
    platform: 'darwin',
    cleanup: false,
  });

  assert.match(result.launchAgentsDir, /chs-dry-probe-/);
  assert.equal(result.installed.length, 1);

  const entries = await readdir(result.launchAgentsDir);
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^com\.local\.cli-heartbeat-scheduler\.dry-probe-claude\.plist$/);
});

test('runRealSmokeTest executes selected fake provider jobs immediately', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-real-smoke-'));
  const results = await runRealSmokeTest(
    {
      workdir: dir,
      logDir: path.join(dir, 'logs'),
      stateDir: path.join(dir, 'state'),
      maxOutputBytes: 20_000,
      jobs: [
        {
          id: 'fake-claude',
          provider: 'claude',
          prompt: 'ignored',
          timeoutMs: 10_000,
          command: process.execPath,
          commandArgs: ['-e', 'console.log("smoke-ok")'],
        },
      ],
    },
    ['claude'],
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'success');
  assert.equal(results[0].stdoutPreview.trim(), 'smoke-ok');
});

test('runDryProbe creates Windows task scripts without provider calls', async () => {
  const result = await runDryProbe(['claude', 'codex'], {
    platform: 'win32',
    cleanup: false,
  });

  assert.equal(result.installed.length, 2);
  assert.match(result.taskScriptsDir, /chs-dry-probe-/);
  assert.match(result.installed[0].script, /Register-ScheduledTask/);
});

test('runDryProbe creates systemd unit pairs on linux without invoking systemctl', async () => {
  const result = await runDryProbe(['claude', 'codex'], {
    platform: 'linux',
    cleanup: false,
  });

  assert.equal(result.installed.length, 2);
  assert.match(result.systemdUserDir, /chs-dry-probe-/);
  assert.match(result.installed[0].service, /run-linux\.sh/);
  assert.match(result.installed[0].timer, /OnCalendar=/);
});
