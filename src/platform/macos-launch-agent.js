import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseTime, timeToJobSuffix } from '../time.js';

const LABEL_PREFIX = 'com.local.cli-heartbeat-scheduler';
const WEEKDAY_TO_LAUNCHD = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function launchdWeekday(weekday) {
  if (!(weekday in WEEKDAY_TO_LAUNCHD)) {
    throw new Error(`Unsupported weekday for launchd: ${weekday}`);
  }

  return WEEKDAY_TO_LAUNCHD[weekday];
}

export function desiredLaunchAgents(config, options = {}) {
  const launchAgentsDir = options.launchAgentsDir || path.join(os.homedir(), 'Library', 'LaunchAgents');
  const runtimeDir = options.runtimeDir || path.join(os.homedir(), '.cli-heartbeat-scheduler', 'app');
  const configPath = options.configPath || path.join(runtimeDir, 'config.json');
  const runScriptPath = options.runScriptPath || path.join(runtimeDir, 'scripts', 'run-macos.sh');
  const nodeBin = options.nodeBin || process.execPath;

  return config.jobs
    .filter((job) => job.enabled !== false)
    .map((job) => {
      const label = `${LABEL_PREFIX}.${job.id}`;
      const plistPath = path.join(launchAgentsDir, `${label}.plist`);
      const plist = buildLaunchAgentPlist({
        label,
        projectDir: runtimeDir,
        configPath,
        job,
        plistPath,
        runScriptPath,
        nodeBin,
        logDir: config.logDir,
      });

      return {
        label,
        plist,
        plistPath,
        job,
      };
    });
}

export function buildLaunchAgentPlist({
  label,
  projectDir,
  configPath,
  job,
  plistPath,
  runScriptPath,
  nodeBin,
  logDir,
}) {
  const mode = job.recurrence?.type === 'once' ? 'once' : 'persistent';
  const calendar = buildStartCalendarInterval(job);
  const safe = {
    label: xmlEscape(label),
    projectDir: xmlEscape(projectDir),
    configPath: xmlEscape(configPath),
    jobId: xmlEscape(job.id),
    plistPath: xmlEscape(plistPath),
    runScriptPath: xmlEscape(runScriptPath),
    nodeBin: xmlEscape(nodeBin),
    logDir: xmlEscape(logDir),
    mode: xmlEscape(mode),
    path: xmlEscape(defaultLaunchdPath()),
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${safe.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${safe.runScriptPath}</string>
    <string>${safe.projectDir}</string>
    <string>${safe.configPath}</string>
    <string>${safe.jobId}</string>
    <string>${safe.label}</string>
    <string>${safe.plistPath}</string>
    <string>${safe.mode}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_BIN</key>
    <string>${safe.nodeBin}</string>
    <key>PATH</key>
    <string>${safe.path}</string>
  </dict>
  <key>StartCalendarInterval</key>
${indent(calendar, 2)}
  <key>StandardOutPath</key>
  <string>${safe.logDir}/${safe.jobId}.launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${safe.logDir}/${safe.jobId}.launchd.err.log</string>
</dict>
</plist>
`;
}

export async function installLaunchAgentFiles(config, options = {}) {
  const launchAgentsDir = options.launchAgentsDir || path.join(os.homedir(), 'Library', 'LaunchAgents');
  await mkdir(launchAgentsDir, { recursive: true });
  const agents = desiredLaunchAgents(config, { ...options, launchAgentsDir });
  const installed = [];

  for (const agent of agents) {
    await writeFile(agent.plistPath, agent.plist, { mode: 0o644 });
    installed.push(agent);

    if (options.load !== false) {
      unloadLaunchAgent(agent.label);
      loadLaunchAgent(agent.plistPath);
    }
  }

  return {
    installed,
  };
}

export async function pruneStaleLaunchAgentFiles({
  launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents'),
  desiredLabels,
  unload = true,
}) {
  await mkdir(launchAgentsDir, { recursive: true });
  const desired = new Set(desiredLabels);
  const entries = await readdir(launchAgentsDir);
  const removed = [];

  for (const entry of entries) {
    if (!entry.startsWith(`${LABEL_PREFIX}.`) || !entry.endsWith('.plist')) {
      continue;
    }

    const label = entry.slice(0, -'.plist'.length);
    if (desired.has(label)) {
      continue;
    }

    if (unload) {
      unloadLaunchAgent(label);
    }

    const plistPath = path.join(launchAgentsDir, entry);
    await rm(plistPath, { force: true });
    removed.push(plistPath);
  }

  return removed;
}

export async function copyRuntime({ sourceDir, runtimeDir, configFile, configTargetName = 'config.json' }) {
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  await cp(path.join(sourceDir, 'src'), path.join(runtimeDir, 'src'), { recursive: true });
  await cp(path.join(sourceDir, 'scripts'), path.join(runtimeDir, 'scripts'), { recursive: true });
  await cp(path.join(sourceDir, 'package.json'), path.join(runtimeDir, 'package.json'));
  await cp(configFile, path.join(runtimeDir, configTargetName));
  await chmod(path.join(runtimeDir, 'scripts', 'run-macos.sh'), 0o755);
}

export async function installMacOSLaunchAgents(config, options = {}) {
  const launchAgentsDir = options.launchAgentsDir || path.join(os.homedir(), 'Library', 'LaunchAgents');
  const agents = desiredLaunchAgents(config, options);
  const removed = await pruneStaleLaunchAgentFiles({
    launchAgentsDir,
    desiredLabels: agents.map((agent) => agent.label),
    unload: options.load !== false,
  });
  const { installed } = await installLaunchAgentFiles(config, {
    ...options,
    launchAgentsDir,
  });

  return {
    installed,
    removed,
  };
}

function buildStartCalendarInterval(job) {
  const time = parseTimeFromJob(job);

  if (job.recurrence?.type === 'weekdays') {
    const items = job.recurrence.weekdays.map((weekday) => calendarDict({
      ...time,
      weekday: launchdWeekday(weekday),
    }));
    return `<array>
${items.map((item) => indent(item, 2)).join('\n')}
</array>`;
  }

  return calendarDict(time);
}

function calendarDict({ hour, minute, weekday }) {
  const weekdayXml = weekday === undefined
    ? ''
    : `  <key>Weekday</key>
  <integer>${weekday}</integer>
`;

  return `<dict>
${weekdayXml}  <key>Hour</key>
  <integer>${hour}</integer>
  <key>Minute</key>
  <integer>${minute}</integer>
</dict>`;
}

function parseTimeFromJob(job) {
  if (job.schedule) {
    const [minute, hour] = job.schedule.trim().split(/\s+/);
    if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
      return parseTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
    }
  }

  const jobId = job.id;
  const suffix = jobId.match(/-(\d{4})$/)?.[1];
  if (!suffix) {
    throw new Error(`Cannot infer HHMM time suffix from job id: ${jobId}`);
  }

  const value = `${suffix.slice(0, 2)}:${suffix.slice(2)}`;
  const parsed = parseTime(value);

  if (timeToJobSuffix(parsed.value) !== suffix) {
    throw new Error(`Invalid time suffix in job id: ${jobId}`);
  }

  return parsed;
}

function loadLaunchAgent(plistPath) {
  const result = spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `launchctl bootstrap failed for ${plistPath}`);
  }
}

function unloadLaunchAgent(label) {
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], {
    stdio: 'ignore',
  });
}

function defaultLaunchdPath() {
  return [
    path.join(os.homedir(), '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(os.homedir(), '.nvm/versions/node/v24.13.0/bin'),
  ].join(':');
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function indent(value, spaces) {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n');
}
