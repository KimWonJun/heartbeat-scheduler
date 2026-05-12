import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildConfigFromSetupAnswers,
  installConfiguredSchedule,
  writeActiveConfig,
} from '../src/setup-core.js';
import { loadConfig } from '../src/config.js';

const execFileAsync = promisify(execFile);

test('buildConfigFromSetupAnswers creates profile config from setup answers', () => {
  const config = buildConfigFromSetupAnswers({
    agents: ['codex', 'claude'],
    times: '16:00,06:00,11:00',
    recurrenceType: 'daily',
    prompt: 'hello',
  });

  assert.equal(config.timezone, 'Asia/Seoul');
  assert.deepEqual(config.scheduleProfile.agents, ['claude', 'codex']);
  assert.deepEqual(config.scheduleProfile.times, ['06:00', '11:00', '16:00']);
  assert.deepEqual(config.scheduleProfile.recurrence, { type: 'daily' });
  assert.equal(config.scheduleProfile.prompt, 'hello');
  assert.equal(config.jobs.length, 6);
});

test('buildConfigFromSetupAnswers supports selected weekdays', () => {
  const config = buildConfigFromSetupAnswers({
    agents: ['gemini'],
    times: ['09:30'],
    recurrenceType: 'weekdays',
    weekdays: ['fri', 'mon'],
  });

  assert.deepEqual(config.scheduleProfile.recurrence, { type: 'weekdays', weekdays: ['mon', 'fri'] });
  assert.equal(config.jobs[0].schedule, '30 9 * * 1,5');
});

test('writeActiveConfig writes normalized config JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-setup-core-'));
  const configPath = path.join(dir, 'config.json');
  const config = buildConfigFromSetupAnswers({
    agents: ['claude'],
    times: ['06:00'],
    recurrenceType: 'once',
  });

  await writeActiveConfig(config, configPath);
  const written = JSON.parse(await readFile(configPath, 'utf8'));

  assert.deepEqual(written.scheduleProfile.agents, ['claude']);
  assert.equal(written.jobs, undefined);

  const loaded = await loadConfig(configPath);
  assert.equal(loaded.jobs[0].id, 'claude-0600');
});

test('installConfiguredSchedule writes config, copies runtime, and installs plists without loading', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-install-configured-'));
  const configPath = path.join(dir, 'config.json');
  const runtimeDir = path.join(dir, 'runtime');
  const runtimeConfigPath = path.join(runtimeDir, 'config.json');
  const launchAgentsDir = path.join(dir, 'LaunchAgents');
  const config = buildConfigFromSetupAnswers({
    agents: ['claude', 'codex'],
    times: ['06:00'],
    recurrenceType: 'daily',
  });

  const result = await installConfiguredSchedule(config, {
    platform: 'darwin',
    sourceDir: process.cwd(),
    configPath,
    runtimeDir,
    runtimeConfigPath,
    launchAgentsDir,
    load: false,
  });

  assert.equal(result.installed.length, 2);
  await stat(path.join(runtimeDir, 'src', 'index.js'));
  const launchAgentFiles = await readdir(launchAgentsDir);
  assert.deepEqual(launchAgentFiles.sort(), [
    'com.local.cli-heartbeat-scheduler.claude-0600.plist',
    'com.local.cli-heartbeat-scheduler.codex-0600.plist',
  ]);
});

test('installConfiguredSchedule installs systemd unit pairs when platform is linux', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-install-linux-'));
  const configPath = path.join(dir, 'config.json');
  const runtimeDir = path.join(dir, 'runtime');
  const runtimeConfigPath = path.join(runtimeDir, 'config.json');
  const systemdUserDir = path.join(dir, 'units');
  const config = buildConfigFromSetupAnswers({
    agents: ['claude', 'codex'],
    times: ['06:00'],
    recurrenceType: 'daily',
  });

  const result = await installConfiguredSchedule(config, {
    platform: 'linux',
    sourceDir: process.cwd(),
    configPath,
    runtimeDir,
    runtimeConfigPath,
    systemdUserDir,
    load: false,
  });

  assert.equal(result.installed.length, 2);
  await stat(path.join(runtimeDir, 'scripts', 'run-linux.sh'));
  const unitFiles = await readdir(systemdUserDir);
  assert.deepEqual(unitFiles.sort(), [
    'cli-heartbeat-scheduler-claude-0600.service',
    'cli-heartbeat-scheduler-claude-0600.timer',
    'cli-heartbeat-scheduler-codex-0600.service',
    'cli-heartbeat-scheduler-codex-0600.timer',
  ]);
});

test('installConfiguredSchedule installs Windows task scripts when platform is win32', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-install-windows-'));
  const configPath = path.join(dir, 'config.json');
  const runtimeDir = path.join(dir, 'runtime');
  const runtimeConfigPath = path.join(runtimeDir, 'config.json');
  const taskScriptsDir = path.join(dir, 'tasks');
  const config = buildConfigFromSetupAnswers({
    agents: ['claude'],
    times: ['06:00'],
    recurrenceType: 'daily',
  });

  const result = await installConfiguredSchedule(config, {
    platform: 'win32',
    sourceDir: process.cwd(),
    configPath,
    runtimeDir,
    runtimeConfigPath,
    taskScriptsDir,
    load: false,
  });

  assert.equal(result.installed.length, 1);
  await stat(path.join(runtimeDir, 'scripts', 'run-windows.ps1'));
  const taskScripts = await readdir(taskScriptsDir);
  assert.deepEqual(taskScripts, ['CLI-Heartbeat-Scheduler-claude-0600.ps1']);
});

test('copied runtime can start non-setup commands without installed prompt dependencies', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-runtime-no-node-modules-'));
  const configPath = path.join(dir, 'config.json');
  const runtimeDir = path.join(dir, 'runtime');
  const runtimeConfigPath = path.join(runtimeDir, 'config.json');
  const launchAgentsDir = path.join(dir, 'LaunchAgents');
  const config = buildConfigFromSetupAnswers({
    agents: ['claude'],
    times: ['06:00'],
    recurrenceType: 'daily',
  });

  await installConfiguredSchedule(config, {
    platform: 'darwin',
    sourceDir: process.cwd(),
    configPath,
    runtimeDir,
    runtimeConfigPath,
    launchAgentsDir,
    load: false,
  });

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(runtimeDir, 'src', 'index.js'),
    '--help',
  ], {
    cwd: runtimeDir,
  });

  assert.match(stdout, /Usage:/);
});
