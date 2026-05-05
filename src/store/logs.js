import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function appendRunLog(logDir, result) {
  await mkdir(logDir, { recursive: true });
  const fileName = `runs-${result.startedAt.slice(0, 10)}.jsonl`;
  const line = `${JSON.stringify(result)}\n`;
  await appendFile(path.join(logDir, fileName), line);
}

export async function writeLastStatus(stateDir, result) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, 'last-status.json'), `${JSON.stringify(result, null, 2)}\n`);
}
