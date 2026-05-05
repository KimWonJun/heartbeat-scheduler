import { spawn } from 'node:child_process';

export function runProcessQuick(file, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs || 10_000);
    timeout.unref();

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      settled = true;
      clearTimeout(timeout);
      resolve({
        status: error.code === 'ENOENT' ? 'missing_cli' : 'failed',
        error: error.message,
        stdout,
        stderr,
      });
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }

      clearTimeout(timeout);
      resolve({
        status: timedOut ? 'timeout' : exitCode === 0 ? 'success' : 'failed',
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}
