import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseTime } from '../time.js';

const UNIT_PREFIX = 'cli-heartbeat-scheduler-';
const WEEKDAY_TO_SYSTEMD = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

export function systemdWeekday(weekday) {
  if (!(weekday in WEEKDAY_TO_SYSTEMD)) {
    throw new Error(`Unsupported weekday for systemd: ${weekday}`);
  }

  return WEEKDAY_TO_SYSTEMD[weekday];
}

export function defaultSystemdUserDir() {
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

export function desiredSystemdUnits(config, options = {}) {
  const systemdUserDir = options.systemdUserDir || defaultSystemdUserDir();
  const runtimeDir = options.runtimeDir || path.join(os.homedir(), '.cli-heartbeat-scheduler', 'app');
  const configPath = options.configPath || path.join(runtimeDir, 'config.json');
  const runScriptPath = options.runScriptPath || path.join(runtimeDir, 'scripts', 'run-linux.sh');
  const nodeBin = options.nodeBin || process.execPath;
  const timezone = options.timezone || config.timezone || 'Asia/Seoul';
  const now = options.now || new Date();

  return config.jobs
    .filter((job) => job.enabled !== false)
    .map((job) => {
      const unitName = `${UNIT_PREFIX}${job.id}`;
      const servicePath = path.join(systemdUserDir, `${unitName}.service`);
      const timerPath = path.join(systemdUserDir, `${unitName}.timer`);
      const mode = job.recurrence?.type === 'once' ? 'once' : 'persistent';
      const service = buildServiceUnit({
        unitName,
        projectDir: runtimeDir,
        configPath,
        job,
        runScriptPath,
        nodeBin,
        logDir: config.logDir,
        mode,
        servicePath,
        timerPath,
        systemdUserDir,
      });
      const timer = buildTimerUnit({
        unitName,
        job,
        timezone,
        now,
      });

      return {
        unitName,
        service,
        timer,
        servicePath,
        timerPath,
        job,
        mode,
      };
    });
}

export function buildServiceUnit({
  unitName,
  projectDir,
  configPath,
  job,
  runScriptPath,
  nodeBin,
  logDir,
  mode,
  servicePath,
  timerPath,
  systemdUserDir,
}) {
  const description = `CLI Heartbeat Scheduler ${job.id}`;
  const execArgs = [
    runScriptPath,
    projectDir,
    configPath,
    job.id,
    unitName,
    servicePath,
    timerPath,
    systemdUserDir,
    mode,
  ].map(quoteSystemdArg).join(' ');

  return `[Unit]
Description=${description}

[Service]
Type=oneshot
WorkingDirectory=${projectDir}
Environment=NODE_BIN=${nodeBin}
Environment=PATH=${defaultLinuxPath()}
ExecStart=${execArgs}
StandardOutput=append:${logDir}/${job.id}.systemd.out.log
StandardError=append:${logDir}/${job.id}.systemd.err.log
`;
}

export function buildTimerUnit({ unitName, job, timezone, now }) {
  const description = `CLI Heartbeat Scheduler ${job.id} timer`;
  const onCalendar = buildOnCalendar(job, timezone, now);

  return `[Unit]
Description=${description}

[Timer]
${onCalendar.map((line) => `OnCalendar=${line}`).join('\n')}
Unit=${unitName}.service
Persistent=false

[Install]
WantedBy=timers.target
`;
}

export async function installSystemdUnitFiles(config, options = {}) {
  const systemdUserDir = options.systemdUserDir || defaultSystemdUserDir();
  await mkdir(systemdUserDir, { recursive: true });
  if (config.logDir) {
    await mkdir(config.logDir, { recursive: true });
  }
  const units = desiredSystemdUnits(config, { ...options, systemdUserDir });
  const installed = [];

  for (const unit of units) {
    await writeFile(unit.servicePath, unit.service, { mode: 0o644 });
    await writeFile(unit.timerPath, unit.timer, { mode: 0o644 });
    installed.push(unit);
  }

  if (options.load !== false) {
    runSystemctl(['daemon-reload'], options);
    for (const unit of installed) {
      runSystemctl(['enable', '--now', `${unit.unitName}.timer`], options);
    }
  }

  return {
    installed,
  };
}

export async function pruneStaleSystemdUnits({
  systemdUserDir = defaultSystemdUserDir(),
  desiredUnitNames,
  unload = true,
  runner,
}) {
  await mkdir(systemdUserDir, { recursive: true });
  const desired = new Set(desiredUnitNames);
  const entries = await readdir(systemdUserDir);
  const removed = [];

  for (const entry of entries) {
    if (!entry.startsWith(UNIT_PREFIX)) {
      continue;
    }

    if (!entry.endsWith('.service') && !entry.endsWith('.timer')) {
      continue;
    }

    const unitName = entry.replace(/\.(service|timer)$/, '');
    if (desired.has(unitName)) {
      continue;
    }

    if (unload && entry.endsWith('.timer')) {
      runSystemctl(['disable', '--now', entry], { runner, ignoreErrors: true });
    }

    const filePath = path.join(systemdUserDir, entry);
    await rm(filePath, { force: true });
    removed.push(filePath);
  }

  if (unload && removed.length > 0) {
    runSystemctl(['daemon-reload'], { runner, ignoreErrors: true });
  }

  return removed;
}

export async function copyLinuxRuntime({ sourceDir, runtimeDir, configFile, configTargetName = 'config.json' }) {
  const { cp, mkdir: fsmkdir, rm: fsrm } = await import('node:fs/promises');
  await fsrm(runtimeDir, { recursive: true, force: true });
  await fsmkdir(runtimeDir, { recursive: true });
  await cp(path.join(sourceDir, 'src'), path.join(runtimeDir, 'src'), { recursive: true });
  await cp(path.join(sourceDir, 'scripts'), path.join(runtimeDir, 'scripts'), { recursive: true });
  await cp(path.join(sourceDir, 'package.json'), path.join(runtimeDir, 'package.json'));
  await cp(configFile, path.join(runtimeDir, configTargetName));
  await chmod(path.join(runtimeDir, 'scripts', 'run-linux.sh'), 0o755);
}

export async function installLinuxSystemdUnits(config, options = {}) {
  const systemdUserDir = options.systemdUserDir || defaultSystemdUserDir();
  const units = desiredSystemdUnits(config, { ...options, systemdUserDir });
  const removed = await pruneStaleSystemdUnits({
    systemdUserDir,
    desiredUnitNames: units.map((unit) => unit.unitName),
    unload: options.load !== false,
    runner: options.runner,
  });
  const { installed } = await installSystemdUnitFiles(config, {
    ...options,
    systemdUserDir,
  });

  return {
    installed,
    removed,
  };
}

export async function listSystemdTimerStatuses(options = {}) {
  const systemdUserDir = options.systemdUserDir || defaultSystemdUserDir();
  let entries;

  try {
    entries = await readdir(systemdUserDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.startsWith(UNIT_PREFIX) && entry.endsWith('.timer'))
    .map((entry) => ({
      unitName: entry.slice(0, -'.timer'.length),
      timerPath: path.join(systemdUserDir, entry),
    }));
}

function buildOnCalendar(job, timezone, now) {
  const time = parseTimeFromJob(job);
  const hhmm = `${pad2(time.hour)}:${pad2(time.minute)}:00`;

  if (job.recurrence?.type === 'once') {
    const target = computeNextRun(time, now);
    const date = `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`;
    return [`${date} ${hhmm} ${timezone}`];
  }

  if (job.recurrence?.type === 'weekdays') {
    const days = job.recurrence.weekdays.map(systemdWeekday).join(',');
    return [`${days} *-*-* ${hhmm} ${timezone}`];
  }

  return [`*-*-* ${hhmm} ${timezone}`];
}

function computeNextRun(time, now) {
  const next = new Date(now);
  next.setHours(time.hour, time.minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function parseTimeFromJob(job) {
  if (job.schedule) {
    const [minute, hour] = job.schedule.trim().split(/\s+/);
    if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
      return parseTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
    }
  }

  throw new Error(`Cannot infer Linux systemd time from schedule: ${job.schedule}`);
}

function runSystemctl(args, options = {}) {
  const runner = options.runner || defaultRunner;
  const result = runner('systemctl', ['--user', ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if (!options.ignoreErrors && result.status !== 0) {
    const message = (result.stderr || result.stdout || `systemctl --user ${args.join(' ')} failed`).trim();
    throw new Error(message);
  }

  return result;
}

function defaultRunner(file, args, spawnOptions) {
  return spawnSync(file, args, spawnOptions);
}

function defaultLinuxPath() {
  return [
    path.join(os.homedir(), '.local/bin'),
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/bin',
    '/sbin',
  ].join(':');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function quoteSystemdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./-]+$/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
