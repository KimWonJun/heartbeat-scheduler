import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildProviderCommand } from './providers/index.js';
import { runProcessQuick } from './process.js';

export async function runDoctor(config) {
  const checks = [];

  for (const dir of [config.workdir, config.logDir, config.stateDir]) {
    checks.push(await checkWritableDir(dir));
  }

  const enabledProviders = new Set(config.jobs.filter((job) => job.enabled).map((job) => job.provider));
  for (const provider of enabledProviders) {
    const sampleJob = config.jobs.find((job) => job.provider === provider);
    checks.push(await checkProviderCommand(sampleJob));
  }

  return checks;
}

async function checkWritableDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    await writeFile(probe, 'ok');
    await unlink(probe);
    return { name: `writable:${dir}`, status: 'ok' };
  } catch (error) {
    return { name: `writable:${dir}`, status: 'failed', message: error.message };
  }
}

async function checkProviderCommand(job) {
  const command = buildProviderCommand({ ...job, prompt: 'doctor' });
  const versionArgs = job.provider === 'claude' ? ['--version'] : ['--version'];
  const result = await runProcessQuick(command.file, versionArgs, { timeoutMs: 10_000 });

  if (result.status === 'success') {
    return {
      name: `${job.provider}:cli`,
      status: 'ok',
      message: result.stdout.trim() || result.stderr.trim(),
    };
  }

  return {
    name: `${job.provider}:cli`,
    status: result.status,
    message: result.stderr || result.error || 'CLI check failed',
  };
}
