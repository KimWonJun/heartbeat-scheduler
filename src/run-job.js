import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { buildProviderCommand } from './providers/index.js';
import { acquireJobLock, releaseJobLock } from './store/locks.js';
import { appendRunLog, writeLastStatus } from './store/logs.js';

export async function runJob(config, job, options = {}) {
  const scheduledAt = options.scheduledAt || new Date();
  await mkdir(job.workdir || config.workdir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });
  await mkdir(config.stateDir, { recursive: true });

  const lock = await acquireJobLock(config.stateDir, job.id);
  if (!lock.acquired) {
    const result = createBaseResult(job, scheduledAt, new Date());
    result.finishedAt = new Date().toISOString();
    result.durationMs = 0;
    result.status = 'skipped_locked';
    result.exitCode = null;
    result.stdoutPreview = '';
    result.stderrPreview = 'Previous run is still active.';
    await persistResult(config, result);
    return result;
  }

  try {
    const command = buildProviderCommand(job);
    const result = await spawnAndCapture(command, {
      cwd: job.workdir || config.workdir,
      timeoutMs: job.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
      job,
      scheduledAt,
    });

    await persistResult(config, result);
    return result;
  } finally {
    await releaseJobLock(lock.lockPath);
  }
}

function createBaseResult(job, scheduledAt, startedAt) {
  return {
    jobId: job.id,
    provider: job.provider,
    scheduledAt: scheduledAt.toISOString(),
    startedAt: startedAt.toISOString(),
  };
}

async function persistResult(config, result) {
  await appendRunLog(config.logDir, result);
  await writeLastStatus(config.stateDir, result);
}

function spawnAndCapture(command, options) {
  const startedAt = new Date();
  const result = createBaseResult(options.job, options.scheduledAt, startedAt);
  const stdout = new OutputBuffer(options.maxOutputBytes);
  const stderr = new OutputBuffer(options.maxOutputBytes);

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;

    const child = spawn(command.file, command.args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 1_000).unref();
    }, options.timeoutMs);
    timeout.unref();

    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));

    child.on('error', (error) => {
      settled = true;
      clearTimeout(timeout);
      const finishedAt = new Date();
      resolve({
        ...result,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status: error.code === 'ENOENT' ? 'missing_cli' : 'failed',
        exitCode: null,
        stdoutPreview: stdout.toString(),
        stderrPreview: error.message,
      });
    });

    child.on('close', (exitCode, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      const finishedAt = new Date();
      const stdoutPreview = stdout.toString();
      const stderrPreview = stderr.toString();
      const status = timedOut
        ? 'timeout'
        : classifyStatus(exitCode, stdoutPreview, stderrPreview);

      resolve({
        ...result,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status,
        exitCode,
        signal,
        stdoutPreview,
        stderrPreview,
      });
    });
  });
}

function classifyStatus(exitCode, stdoutPreview, stderrPreview) {
  if (exitCode === 0) {
    return 'success';
  }

  const combined = `${stdoutPreview}\n${stderrPreview}`.toLowerCase();
  if (combined.includes('login') || combined.includes('auth') || combined.includes('api key')) {
    return 'auth_required';
  }
  if (combined.includes('permission') || combined.includes('approval')) {
    return 'permission_blocked';
  }

  return 'failed';
}

class OutputBuffer {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.bytes = 0;
    this.truncated = false;
  }

  push(chunk) {
    if (this.bytes >= this.maxBytes) {
      this.truncated = true;
      return;
    }

    const remaining = this.maxBytes - this.bytes;
    const next = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    this.chunks.push(next);
    this.bytes += next.length;
    if (next.length < chunk.length) {
      this.truncated = true;
    }
  }

  toString() {
    const value = Buffer.concat(this.chunks).toString('utf8');
    return this.truncated ? `${value}\n[truncated]` : value;
  }
}
