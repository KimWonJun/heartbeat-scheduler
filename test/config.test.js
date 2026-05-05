import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { expandHome, loadConfig } from '../src/config.js';

test('expandHome expands leading tilde only', () => {
  assert.equal(expandHome('~/logs'), path.join(os.homedir(), 'logs'));
  assert.equal(expandHome('/tmp/~literal'), '/tmp/~literal');
});

test('loadConfig validates and normalizes enabled jobs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-config-'));
  const configPath = path.join(dir, 'config.json');

  await writeFile(
    configPath,
    JSON.stringify({
      timezone: 'Asia/Seoul',
      workdir: '~/heartbeat-workdir',
      logDir: '~/heartbeat-logs',
      jobs: [
        {
          id: 'claude-job',
          provider: 'claude',
          schedule: '0 9 * * *',
          prompt: 'test!',
        },
        {
          id: 'disabled-job',
          provider: 'codex',
          schedule: '5 9 * * *',
          prompt: 'skip',
          enabled: false,
        },
      ],
    }),
  );

  const config = await loadConfig(configPath);

  assert.equal(config.timezone, 'Asia/Seoul');
  assert.equal(config.defaultTimeoutMs, 60_000);
  assert.equal(config.maxOutputBytes, 20_000);
  assert.equal(config.jobs.length, 2);
  assert.equal(config.jobs[0].enabled, true);
  assert.equal(config.jobs[1].enabled, false);
  assert.equal(config.jobs[0].timeoutMs, 60_000);
  assert.equal(config.stateDir, path.join(os.homedir(), '.cli-heartbeat-scheduler', 'state'));
});

test('loadConfig rejects duplicate job ids', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-config-'));
  const configPath = path.join(dir, 'config.json');

  await writeFile(
    configPath,
    JSON.stringify({
      jobs: [
        { id: 'dup', provider: 'claude', schedule: '* * * * *', prompt: 'a' },
        { id: 'dup', provider: 'codex', schedule: '* * * * *', prompt: 'b' },
      ],
    }),
  );

  await assert.rejects(() => loadConfig(configPath), /duplicate job id/i);
});
