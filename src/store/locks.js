import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function acquireJobLock(stateDir, jobId) {
  const locksDir = path.join(stateDir, 'locks');
  await mkdir(locksDir, { recursive: true });

  const lockPath = path.join(locksDir, `${safeFileName(jobId)}.lock`);
  const content = JSON.stringify(
    {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  );

  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(content);
    await handle.close();
    return { acquired: true, lockPath };
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }

    if (await isLockAlive(lockPath)) {
      return { acquired: false, lockPath };
    }

    await unlink(lockPath).catch(() => {});
    return acquireJobLock(stateDir, jobId);
  }
}

export async function releaseJobLock(lockPath) {
  if (!lockPath) {
    return;
  }

  await unlink(lockPath).catch((error) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
}

async function isLockAlive(lockPath) {
  try {
    const raw = await readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw);
    return Number.isInteger(lock.pid) && processAlive(lock.pid);
  } catch {
    return false;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function safeFileName(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}
