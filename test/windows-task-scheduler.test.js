import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildPowerShellArgs,
  buildRegisterTaskScript,
  desiredWindowsTasks,
  installWindowsScheduledTasks,
  listWindowsScheduledTaskStatuses,
  pruneStaleWindowsTasks,
  windowsDayOfWeek,
} from '../src/platform/windows-task-scheduler.js';

test('windowsDayOfWeek maps scheduler weekdays to PowerShell names', () => {
  assert.equal(windowsDayOfWeek('mon'), 'Monday');
  assert.equal(windowsDayOfWeek('sun'), 'Sunday');
  assert.equal(windowsDayOfWeek('sat'), 'Saturday');
});

test('desiredWindowsTasks creates task metadata for enabled jobs only', () => {
  const tasks = desiredWindowsTasks(
    {
      jobs: [
        { id: 'claude-0600', enabled: true, recurrence: { type: 'daily' }, schedule: '0 6 * * *' },
        { id: 'codex-1100', enabled: false, recurrence: { type: 'daily' }, schedule: '0 11 * * *' },
      ],
    },
    {
      runtimeDir: 'C:\\Users\\me\\.cli-heartbeat-scheduler\\app',
      configPath: 'C:\\Users\\me\\.cli-heartbeat-scheduler\\app\\config.json',
      nodeBin: 'C:\\Program Files\\nodejs\\node.exe',
    },
  );

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].taskName, 'CLI Heartbeat Scheduler claude-0600');
  assert.equal(tasks[0].mode, 'persistent');
  assert.match(tasks[0].actionArgs, /run-windows\.ps1/);
  assert.match(tasks[0].actionArgs, /claude-0600/);
});

test('buildRegisterTaskScript creates daily trigger script with safe quoting', () => {
  const [task] = desiredWindowsTasks(
    {
      jobs: [
        { id: 'claude-0600', enabled: true, recurrence: { type: 'daily' }, schedule: '0 6 * * *' },
      ],
    },
    {
      runtimeDir: 'C:\\Path With Space\\app',
      configPath: 'C:\\Path With Space\\app\\config.json',
      nodeBin: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    },
  );

  const script = buildRegisterTaskScript(task);

  assert.match(script, /\$Trigger = New-ScheduledTaskTrigger -Daily -At '06:00'/);
  assert.match(script, /Register-ScheduledTask/);
  assert.match(script, /CLI Heartbeat Scheduler claude-0600/);
  assert.match(script, /C:\\Path With Space\\app/);
});

test('buildRegisterTaskScript creates weekly trigger for selected weekdays', () => {
  const [task] = desiredWindowsTasks(
    {
      jobs: [
        {
          id: 'gemini-1605',
          enabled: true,
          recurrence: { type: 'weekdays', weekdays: ['mon', 'wed', 'fri'] },
          schedule: '5 16 * * 1,3,5',
        },
      ],
    },
    { runtimeDir: 'C:\\runtime', configPath: 'C:\\runtime\\config.json' },
  );

  const script = buildRegisterTaskScript(task);

  assert.match(script, /New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Wednesday,Friday -At '16:05'/);
});

test('buildRegisterTaskScript creates next one-shot trigger date', () => {
  const [task] = desiredWindowsTasks(
    {
      jobs: [
        { id: 'codex-0600', enabled: true, recurrence: { type: 'once' }, schedule: '0 6 * * *' },
      ],
    },
    {
      runtimeDir: 'C:\\runtime',
      configPath: 'C:\\runtime\\config.json',
      now: new Date('2026-05-05T08:00:00+09:00'),
    },
  );

  const script = buildRegisterTaskScript(task);

  assert.match(script, /\$Trigger = New-ScheduledTaskTrigger -Once -At '2026-05-06 06:00'/);
  assert.equal(task.mode, 'once');
});

test('installWindowsScheduledTasks writes scripts without invoking PowerShell when load is false', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-win-install-'));
  const result = await installWindowsScheduledTasks(
    {
      jobs: [{ id: 'claude-0600', enabled: true, recurrence: { type: 'daily' }, schedule: '0 6 * * *' }],
    },
    {
      runtimeDir: path.join(dir, 'runtime'),
      configPath: path.join(dir, 'runtime', 'config.json'),
      taskScriptsDir: path.join(dir, 'tasks'),
      load: false,
    },
  );

  assert.equal(result.installed.length, 1);
  const files = await readdir(path.join(dir, 'tasks'));
  assert.equal(files.length, 1);
  assert.match(await readFile(result.installed[0].scriptPath, 'utf8'), /Register-ScheduledTask/);
});

test('pruneStaleWindowsTasks unregisters only scheduler-owned stale tasks', async () => {
  const calls = [];
  const removed = await pruneStaleWindowsTasks({
    desiredTaskNames: ['CLI Heartbeat Scheduler keep'],
    taskRows: [
      { TaskName: 'CLI Heartbeat Scheduler keep' },
      { TaskName: 'CLI Heartbeat Scheduler old' },
      { TaskName: 'Other Task' },
    ],
    runner: (file, args) => {
      calls.push({ file, args });
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.deepEqual(removed, ['CLI Heartbeat Scheduler old']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args.join(' '), /Unregister-ScheduledTask/);
  assert.doesNotMatch(calls[0].args.join(' '), /Other Task/);
});

test('listWindowsScheduledTaskStatuses parses PowerShell JSON output', async () => {
  const statuses = await listWindowsScheduledTaskStatuses({
    runner: () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          TaskName: 'CLI Heartbeat Scheduler claude-0600',
          State: 'Ready',
          LastRunTime: '2026-05-05T06:00:00',
          LastTaskResult: 0,
        },
      ]),
      stderr: '',
    }),
  });

  assert.equal(statuses[0].taskName, 'CLI Heartbeat Scheduler claude-0600');
  assert.equal(statuses[0].state, 'Ready');
  assert.equal(statuses[0].lastTaskResult, 0);
});

test('buildPowerShellArgs uses non-interactive execution flags', () => {
  assert.deepEqual(buildPowerShellArgs('-Command', 'Write-Output ok'), [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Write-Output ok',
  ]);
});
