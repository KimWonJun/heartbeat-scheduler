import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runJob } from '../src/run-job.js';

test('runJob executes fake provider command and writes logs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-run-'));

  const config = {
    workdir: dir,
    logDir: path.join(dir, 'logs'),
    stateDir: path.join(dir, 'state'),
    maxOutputBytes: 20_000,
  };
  const job = {
    id: 'fake-claude',
    provider: 'claude',
    prompt: 'ignored',
    timeoutMs: 10_000,
    command: process.execPath,
    commandArgs: ['-e', 'console.log("heartbeat-ok")'],
  };

  const result = await runJob(config, job);

  assert.equal(result.status, 'success');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutPreview.trim(), 'heartbeat-ok');

  const log = await readFile(path.join(config.logDir, `runs-${result.startedAt.slice(0, 10)}.jsonl`), 'utf8');
  assert.match(log, /fake-claude/);
});

test('runJob reports timeout', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-run-'));

  const result = await runJob(
    {
      workdir: dir,
      logDir: path.join(dir, 'logs'),
      stateDir: path.join(dir, 'state'),
      maxOutputBytes: 20_000,
    },
    {
      id: 'timeout-job',
      provider: 'claude',
      prompt: 'ignored',
      timeoutMs: 100,
      command: process.execPath,
      commandArgs: ['-e', 'setTimeout(() => console.log("late"), 2000)'],
    },
  );

  assert.equal(result.status, 'timeout');
});

test('runJob closes child stdin so non-interactive CLIs do not wait forever', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-run-'));

  const result = await runJob(
    {
      workdir: dir,
      logDir: path.join(dir, 'logs'),
      stateDir: path.join(dir, 'state'),
      maxOutputBytes: 20_000,
    },
    {
      id: 'stdin-job',
      provider: 'claude',
      prompt: 'ignored',
      timeoutMs: 1_000,
      command: process.execPath,
      commandArgs: [
        '-e',
        'process.stdin.resume(); process.stdin.on("end", () => console.log("stdin-closed"))',
      ],
    },
  );

  assert.equal(result.status, 'success');
  assert.equal(result.stdoutPreview.trim(), 'stdin-closed');
});
