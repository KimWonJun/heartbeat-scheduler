import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { defaultRuntimeConfigPath, defaultRuntimeDir } from '../paths.js';
import { parseTime } from '../time.js';

const TASK_PREFIX = 'CLI Heartbeat Scheduler ';
const WEEKDAY_TO_WINDOWS = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

export function windowsDayOfWeek(weekday) {
  if (!(weekday in WEEKDAY_TO_WINDOWS)) {
    throw new Error(`Unsupported weekday for Windows Task Scheduler: ${weekday}`);
  }

  return WEEKDAY_TO_WINDOWS[weekday];
}

export function desiredWindowsTasks(config, options = {}) {
  const runtimeDir = options.runtimeDir || defaultRuntimeDir();
  const configPath = options.configPath || defaultRuntimeConfigPath();
  const runScriptPath = options.runScriptPath || path.join(runtimeDir, 'scripts', 'run-windows.ps1');
  const powerShellBin = options.powerShellBin || defaultPowerShellBin();
  const nodeBin = options.nodeBin || process.execPath;
  const now = options.now || new Date();

  return config.jobs
    .filter((job) => job.enabled !== false)
    .map((job) => {
      const taskName = `${TASK_PREFIX}${job.id}`;
      const mode = job.recurrence?.type === 'once' ? 'once' : 'persistent';
      const time = parseTimeFromJob(job);
      const actionArgs = buildScheduledTaskActionArgs({
        runScriptPath,
        runtimeDir,
        configPath,
        jobId: job.id,
        taskName,
        mode,
        nodeBin,
      });

      return {
        taskName,
        scriptFileName: `${taskName.replaceAll(' ', '-')}.ps1`,
        actionExecute: powerShellBin,
        actionArgs,
        runtimeDir,
        configPath,
        runScriptPath,
        job,
        mode,
        time,
        trigger: buildTrigger(job, time, now),
      };
    });
}

export function buildRegisterTaskScript(task) {
  const lines = [
    '$ErrorActionPreference = \'Stop\'',
    `$Action = New-ScheduledTaskAction -Execute ${psQuote(task.actionExecute)} -Argument ${psQuote(task.actionArgs)} -WorkingDirectory ${psQuote(task.runtimeDir)}`,
    buildTriggerLine(task.trigger),
    '$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)',
    `$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege`,
    `Unregister-ScheduledTask -TaskName ${psQuote(task.taskName)} -Confirm:$false -ErrorAction SilentlyContinue`,
    `Register-ScheduledTask -TaskName ${psQuote(task.taskName)} -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Local CLI heartbeat scheduler job' -Force | Out-Null`,
  ];

  return `${lines.join('\n')}\n`;
}

export function buildUnregisterTaskScript(taskName) {
  return `Unregister-ScheduledTask -TaskName ${psQuote(taskName)} -Confirm:$false -ErrorAction SilentlyContinue`;
}

export async function installWindowsScheduledTasks(config, options = {}) {
  const taskScriptsDir = options.taskScriptsDir || path.join(options.runtimeDir || defaultRuntimeDir(), 'tasks');
  await mkdir(taskScriptsDir, { recursive: true });
  const tasks = desiredWindowsTasks(config, options);
  const installed = [];

  for (const task of tasks) {
    const script = buildRegisterTaskScript(task);
    const scriptPath = path.join(taskScriptsDir, task.scriptFileName);
    await writeFile(scriptPath, script, { mode: 0o644 });

    const installedTask = {
      ...task,
      script,
      scriptPath,
    };
    installed.push(installedTask);

    if (options.load !== false) {
      const result = runPowerShellFile(scriptPath, options);
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `Register-ScheduledTask failed for ${task.taskName}`);
      }
    }
  }

  return {
    installed,
  };
}

export async function pruneStaleWindowsTasks(options = {}) {
  const desired = new Set(options.desiredTaskNames || []);
  const rows = options.taskRows
    ? normalizeTaskRows(options.taskRows)
    : await listWindowsScheduledTaskStatuses(options);
  const removed = [];

  for (const row of rows) {
    if (!row.taskName.startsWith(TASK_PREFIX) || desired.has(row.taskName)) {
      continue;
    }

    if (options.unload !== false) {
      const result = runPowerShellCommand(buildUnregisterTaskScript(row.taskName), options);
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `Unregister-ScheduledTask failed for ${row.taskName}`);
      }
    }

    removed.push(row.taskName);
  }

  return removed;
}

export async function installWindowsScheduledTasksWithPrune(config, options = {}) {
  const tasks = desiredWindowsTasks(config, options);
  const removed = options.load === false && !options.taskRows
    ? []
    : await pruneStaleWindowsTasks({
      ...options,
      desiredTaskNames: tasks.map((task) => task.taskName),
      unload: options.load !== false,
    });
  const { installed } = await installWindowsScheduledTasks(config, options);

  return {
    installed,
    removed,
  };
}

export async function listWindowsScheduledTaskStatuses(options = {}) {
  if (options.taskRows) {
    return normalizeTaskRows(options.taskRows);
  }

  const command = [
    `$Tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like ${psQuote(`${TASK_PREFIX}*`)} }`,
    '$Rows = foreach ($Task in $Tasks) {',
    '  $Info = Get-ScheduledTaskInfo -TaskName $Task.TaskName -ErrorAction SilentlyContinue',
    '  [PSCustomObject]@{',
    '    TaskName = $Task.TaskName',
    '    State = [string]$Task.State',
    '    LastRunTime = if ($Info) { [string]$Info.LastRunTime } else { $null }',
    '    LastTaskResult = if ($Info) { $Info.LastTaskResult } else { $null }',
    '  }',
    '}',
    '$Rows | ConvertTo-Json -Compress',
  ].join('\n');

  const result = runPowerShellCommand(command, options);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Get-ScheduledTask failed');
  }
  if (!result.stdout.trim()) {
    return [];
  }

  const parsed = JSON.parse(result.stdout);
  return normalizeTaskRows(Array.isArray(parsed) ? parsed : [parsed]);
}

export function buildPowerShellArgs(...args) {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    ...args,
  ];
}

function buildTrigger(job, time, now) {
  if (job.recurrence?.type === 'once') {
    return {
      type: 'once',
      at: nextRunDateTime(time, now),
    };
  }

  if (job.recurrence?.type === 'weekdays') {
    return {
      type: 'weekdays',
      at: time.value,
      weekdays: job.recurrence.weekdays.map(windowsDayOfWeek),
    };
  }

  return {
    type: 'daily',
    at: time.value,
  };
}

function buildTriggerLine(trigger) {
  if (trigger.type === 'once') {
    return `$Trigger = New-ScheduledTaskTrigger -Once -At ${psQuote(trigger.at)}`;
  }

  if (trigger.type === 'weekdays') {
    return `$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${trigger.weekdays.join(',')} -At ${psQuote(trigger.at)}`;
  }

  return `$Trigger = New-ScheduledTaskTrigger -Daily -At ${psQuote(trigger.at)}`;
}

function buildScheduledTaskActionArgs({
  runScriptPath,
  runtimeDir,
  configPath,
  jobId,
  taskName,
  mode,
  nodeBin,
}) {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    quoteForPowerShellArgument(runScriptPath),
    '-ProjectDir',
    quoteForPowerShellArgument(runtimeDir),
    '-ConfigPath',
    quoteForPowerShellArgument(configPath),
    '-JobId',
    quoteForPowerShellArgument(jobId),
    '-TaskName',
    quoteForPowerShellArgument(taskName),
    '-Mode',
    quoteForPowerShellArgument(mode),
    '-NodeBin',
    quoteForPowerShellArgument(nodeBin),
  ].join(' ');
}

function nextRunDateTime(time, now) {
  const next = new Date(now);
  next.setHours(time.hour, time.minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return [
    next.getFullYear(),
    '-',
    String(next.getMonth() + 1).padStart(2, '0'),
    '-',
    String(next.getDate()).padStart(2, '0'),
    ' ',
    time.value,
  ].join('');
}

function parseTimeFromJob(job) {
  const [minute, hour] = job.schedule.trim().split(/\s+/);
  if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    return parseTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
  }

  throw new Error(`Cannot infer Windows task time from schedule: ${job.schedule}`);
}

function normalizeTaskRows(rows) {
  return rows.map((row) => ({
    taskName: row.taskName || row.TaskName,
    state: row.state || row.State,
    lastRunTime: row.lastRunTime || row.LastRunTime,
    lastTaskResult: row.lastTaskResult ?? row.LastTaskResult,
  }));
}

function runPowerShellFile(scriptPath, options) {
  return runPowerShell(['-File', scriptPath], options);
}

function runPowerShellCommand(command, options) {
  return runPowerShell(['-Command', command], options);
}

function runPowerShell(args, options = {}) {
  const runner = options.runner || defaultRunner;
  return runner(options.powerShellBin || defaultPowerShellBin(), buildPowerShellArgs(...args), {
    cwd: options.cwd,
  });
}

function defaultRunner(file, args, options) {
  return spawnSync(file, args, {
    cwd: options?.cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

function defaultPowerShellBin() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

function quoteForPowerShellArgument(value) {
  return `"${String(value).replaceAll('"', '`"')}"`;
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
