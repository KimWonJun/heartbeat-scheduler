import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeConfig } from './config.js';
import { copyLinuxRuntime, installLinuxSystemdUnits } from './platform/linux-systemd.js';
import { copyRuntime, installMacOSLaunchAgents } from './platform/macos-launch-agent.js';
import { installWindowsScheduledTasksWithPrune } from './platform/windows-task-scheduler.js';
import { normalizeScheduleProfile } from './schedule-profile.js';

export function buildConfigFromSetupAnswers(answers) {
  const recurrence = buildRecurrence(answers);
  const scheduleProfile = normalizeScheduleProfile({
    agents: answers.agents,
    times: answers.times,
    recurrence,
    prompt: answers.prompt,
  });

  return normalizeConfig({
    timezone: 'Asia/Seoul',
    workdir: '~/.cli-heartbeat-scheduler/workdir',
    logDir: '~/.cli-heartbeat-scheduler/logs',
    stateDir: '~/.cli-heartbeat-scheduler/state',
    defaultTimeoutMs: 60_000,
    maxOutputBytes: 20_000,
    scheduleProfile,
  });
}

export async function writeActiveConfig(config, configPath) {
  await mkdir(path.dirname(configPath), { recursive: true });
  const serializable = {
    timezone: config.timezone,
    workdir: '~/.cli-heartbeat-scheduler/workdir',
    logDir: '~/.cli-heartbeat-scheduler/logs',
    stateDir: '~/.cli-heartbeat-scheduler/state',
    defaultTimeoutMs: config.defaultTimeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    scheduleProfile: config.scheduleProfile,
  };

  await writeFile(configPath, `${JSON.stringify(serializable, null, 2)}\n`);
}

export async function installConfiguredSchedule(config, options = {}) {
  const {
    sourceDir = process.cwd(),
    configPath,
    runtimeDir,
    runtimeConfigPath,
    launchAgentsDir,
    runScriptPath,
    nodeBin = process.execPath,
    load = true,
    platform = process.platform,
  } = options;

  if (!configPath) {
    throw new Error('installConfiguredSchedule requires configPath');
  }
  if (!runtimeDir) {
    throw new Error('installConfiguredSchedule requires runtimeDir');
  }
  if (!runtimeConfigPath) {
    throw new Error('installConfiguredSchedule requires runtimeConfigPath');
  }

  await writeActiveConfig(config, configPath);
  if (platform === 'linux') {
    await copyLinuxRuntime({
      sourceDir,
      runtimeDir,
      configFile: configPath,
      configTargetName: path.basename(runtimeConfigPath),
    });
  } else {
    await copyRuntime({
      sourceDir,
      runtimeDir,
      configFile: configPath,
      configTargetName: path.basename(runtimeConfigPath),
    });
  }

  if (platform === 'win32') {
    return installWindowsScheduledTasksWithPrune(config, {
      ...options,
      runtimeDir,
      configPath: runtimeConfigPath,
      nodeBin,
      load,
    });
  }

  if (platform === 'darwin') {
    return installMacOSLaunchAgents(config, {
      runtimeDir,
      configPath: runtimeConfigPath,
      launchAgentsDir,
      runScriptPath,
      nodeBin,
      load,
    });
  }

  if (platform === 'linux') {
    return installLinuxSystemdUnits(config, {
      ...options,
      runtimeDir,
      configPath: runtimeConfigPath,
      runScriptPath,
      nodeBin,
      load,
    });
  }

  throw new Error(`Unsupported scheduler install platform: ${platform}`);
}

function buildRecurrence(answers) {
  if (answers.recurrenceType === 'daily') {
    return { type: 'daily' };
  }

  if (answers.recurrenceType === 'weekdays') {
    return { type: 'weekdays', weekdays: answers.weekdays || [] };
  }

  return { type: 'once' };
}
