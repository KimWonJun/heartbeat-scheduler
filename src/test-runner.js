import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { installSystemdUnitFiles, pruneStaleSystemdUnits } from './platform/linux-systemd.js';
import { installLaunchAgentFiles, pruneStaleLaunchAgentFiles } from './platform/macos-launch-agent.js';
import { installWindowsScheduledTasks, pruneStaleWindowsTasks } from './platform/windows-task-scheduler.js';
import { runJob } from './run-job.js';

export function buildDryProbeConfig(agents, options = {}) {
  const rootDir = options.rootDir || path.join(os.homedir(), '.cli-heartbeat-scheduler', 'dry-probe');
  const selected = normalizeAgents(agents);

  return {
    timezone: 'Asia/Seoul',
    workdir: path.join(rootDir, 'workdir'),
    logDir: path.join(rootDir, 'logs'),
    stateDir: path.join(rootDir, 'state'),
    defaultTimeoutMs: 10_000,
    maxOutputBytes: 20_000,
    jobs: selected.map((agent) => ({
      id: `dry-probe-${agent}`,
      provider: agent,
      schedule: '0 0 * * *',
      prompt: 'dry probe',
      enabled: true,
      recurrence: { type: 'once' },
      timeoutMs: 10_000,
      command: process.execPath,
      commandArgs: ['-e', `console.log("dry-probe-ok:${agent}")`],
    })),
  };
}

export async function runDryProbe(agents, options = {}) {
  const rootDir = options.rootDir || await mkdtemp(path.join(os.tmpdir(), 'chs-dry-probe-'));
  const platform = options.platform || process.platform;
  if (platform === 'linux') {
    const load = options.load ?? false;
    const runtimeDir = options.runtimeDir || path.join(rootDir, 'runtime');
    const configPath = options.configPath || path.join(runtimeDir, 'config.json');
    const systemdUserDir = options.systemdUserDir || path.join(rootDir, 'systemd');
    const runScriptPath = options.runScriptPath || path.join(runtimeDir, 'scripts', 'run-linux.sh');
    const config = buildDryProbeConfig(agents, {
      ...options,
      rootDir,
    });
    const result = await installSystemdUnitFiles(config, {
      ...options,
      runtimeDir,
      configPath,
      systemdUserDir,
      runScriptPath,
      load,
    });

    if (options.cleanup !== false) {
      await pruneStaleSystemdUnits({
        systemdUserDir,
        desiredUnitNames: [],
        unload: load,
        runner: options.runner,
      });
    }

    return {
      ...result,
      rootDir,
      systemdUserDir,
    };
  }

  if (platform === 'win32') {
    const load = options.load ?? false;
    const runtimeDir = options.runtimeDir || path.join(rootDir, 'runtime');
    const configPath = options.configPath || path.join(runtimeDir, 'config.json');
    const taskScriptsDir = options.taskScriptsDir || path.join(rootDir, 'tasks');
    const config = buildDryProbeConfig(agents, {
      ...options,
      rootDir,
    });
    const result = await installWindowsScheduledTasks(config, {
      ...options,
      runtimeDir,
      configPath,
      taskScriptsDir,
      load,
    });

    if (options.cleanup !== false) {
      await pruneStaleWindowsTasks({
        ...options,
        taskRows: result.installed.map((task) => ({ TaskName: task.taskName })),
        desiredTaskNames: [],
        unload: load,
      });
    }

    return {
      ...result,
      rootDir,
      taskScriptsDir,
    };
  }

  const launchAgentsDir = options.launchAgentsDir || path.join(rootDir, 'LaunchAgents');
  const runtimeDir = options.runtimeDir || path.join(rootDir, 'runtime');
  const configPath = options.configPath || path.join(runtimeDir, 'config.json');
  const runScriptPath = options.runScriptPath || path.join(runtimeDir, 'scripts', 'run-macos.sh');
  const config = buildDryProbeConfig(agents, {
    ...options,
    rootDir,
  });
  const result = await installLaunchAgentFiles(config, {
    ...options,
    launchAgentsDir,
    runtimeDir,
    configPath,
    runScriptPath,
    load: options.load ?? false,
  });

  if (options.cleanup !== false) {
    await pruneStaleLaunchAgentFiles({
      launchAgentsDir,
      desiredLabels: [],
      unload: options.load !== false,
    });
  }

  return {
    ...result,
    rootDir,
    launchAgentsDir,
  };
}

export async function runRealSmokeTest(config, agents) {
  const selected = new Set(normalizeAgents(agents));
  const jobs = config.jobs.filter((job) => selected.has(job.provider));
  const results = [];

  for (const job of jobs) {
    results.push(await runJob(config, job));
  }

  return results;
}

function normalizeAgents(agents) {
  if (typeof agents === 'string') {
    return agents.split(',').map((agent) => agent.trim()).filter(Boolean);
  }

  if (Array.isArray(agents)) {
    return agents;
  }

  return ['claude', 'codex', 'antigravity'];
}
