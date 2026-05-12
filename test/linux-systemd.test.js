import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildServiceUnit,
  buildTimerUnit,
  copyLinuxRuntime,
  desiredSystemdUnits,
  installSystemdUnitFiles,
  pruneStaleSystemdUnits,
  systemdWeekday,
} from '../src/platform/linux-systemd.js';

const noopRunner = () => ({ status: 0, stdout: '', stderr: '' });

test('systemdWeekday maps short names to systemd day abbreviations', () => {
  assert.equal(systemdWeekday('sun'), 'Sun');
  assert.equal(systemdWeekday('mon'), 'Mon');
  assert.equal(systemdWeekday('sat'), 'Sat');
});

test('buildTimerUnit emits OnCalendar with timezone for daily recurrence', () => {
  const unit = buildTimerUnit({
    unitName: 'cli-heartbeat-scheduler-claude-0600',
    job: { id: 'claude-0600', schedule: '0 6 * * *', recurrence: { type: 'daily' } },
    timezone: 'Asia/Seoul',
    now: new Date('2026-05-12T00:00:00Z'),
  });

  assert.match(unit, /OnCalendar=\*-\*-\* 06:00:00 Asia\/Seoul/);
  assert.match(unit, /WantedBy=timers\.target/);
  assert.match(unit, /Unit=cli-heartbeat-scheduler-claude-0600\.service/);
});

test('buildTimerUnit emits weekday list when recurrence is weekdays', () => {
  const unit = buildTimerUnit({
    unitName: 'cli-heartbeat-scheduler-gemini-1605',
    job: {
      id: 'gemini-1605',
      schedule: '5 16 * * 1,3,5',
      recurrence: { type: 'weekdays', weekdays: ['mon', 'wed', 'fri'] },
    },
    timezone: 'Asia/Seoul',
    now: new Date('2026-05-12T00:00:00Z'),
  });

  assert.match(unit, /OnCalendar=Mon,Wed,Fri \*-\*-\* 16:05:00 Asia\/Seoul/);
});

test('buildTimerUnit emits absolute date for one-shot recurrence', () => {
  const unit = buildTimerUnit({
    unitName: 'cli-heartbeat-scheduler-claude-0600',
    job: { id: 'claude-0600', schedule: '0 6 * * *', recurrence: { type: 'once' } },
    timezone: 'Asia/Seoul',
    now: new Date('2026-05-12T00:00:00Z'),
  });

  assert.match(unit, /OnCalendar=2026-05-\d{2} 06:00:00 Asia\/Seoul/);
});

test('buildServiceUnit references run-linux.sh ExecStart and writes logs to logDir', () => {
  const unit = buildServiceUnit({
    unitName: 'cli-heartbeat-scheduler-claude-0600',
    projectDir: '/runtime',
    configPath: '/runtime/config.json',
    job: { id: 'claude-0600' },
    runScriptPath: '/runtime/scripts/run-linux.sh',
    nodeBin: '/usr/bin/node',
    logDir: '/logs',
    mode: 'persistent',
    servicePath: '/units/cli-heartbeat-scheduler-claude-0600.service',
    timerPath: '/units/cli-heartbeat-scheduler-claude-0600.timer',
    systemdUserDir: '/units',
  });

  assert.match(unit, /Type=oneshot/);
  assert.match(unit, /WorkingDirectory=\/runtime/);
  assert.match(unit, /Environment=NODE_BIN=\/usr\/bin\/node/);
  assert.match(unit, /ExecStart=\/runtime\/scripts\/run-linux\.sh \/runtime \/runtime\/config\.json claude-0600/);
  assert.match(unit, /persistent/);
  assert.match(unit, /StandardOutput=append:\/logs\/claude-0600\.systemd\.out\.log/);
  assert.match(unit, /StandardError=append:\/logs\/claude-0600\.systemd\.err\.log/);
});

test('desiredSystemdUnits builds unit pairs for enabled jobs only', () => {
  const units = desiredSystemdUnits(
    {
      jobs: [
        { id: 'claude-0600', enabled: true, schedule: '0 6 * * *', recurrence: { type: 'daily' } },
        { id: 'codex-1100', enabled: false, schedule: '0 11 * * *', recurrence: { type: 'daily' } },
      ],
      logDir: '/logs',
    },
    {
      systemdUserDir: '/units',
      runtimeDir: '/runtime',
      configPath: '/runtime/config.json',
      runScriptPath: '/runtime/scripts/run-linux.sh',
      nodeBin: '/node',
    },
  );

  assert.equal(units.length, 1);
  assert.equal(units[0].unitName, 'cli-heartbeat-scheduler-claude-0600');
  assert.equal(units[0].servicePath, '/units/cli-heartbeat-scheduler-claude-0600.service');
  assert.equal(units[0].timerPath, '/units/cli-heartbeat-scheduler-claude-0600.timer');
});

test('installSystemdUnitFiles writes service and timer pairs without invoking systemctl when load is false', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-systemd-install-'));
  const result = await installSystemdUnitFiles(
    {
      jobs: [{ id: 'claude-0600', enabled: true, schedule: '0 6 * * *', recurrence: { type: 'daily' } }],
      logDir: path.join(dir, 'logs'),
    },
    {
      systemdUserDir: path.join(dir, 'units'),
      runtimeDir: path.join(dir, 'runtime'),
      configPath: path.join(dir, 'runtime', 'config.json'),
      runScriptPath: path.join(dir, 'runtime', 'scripts', 'run-linux.sh'),
      nodeBin: process.execPath,
      load: false,
    },
  );

  assert.equal(result.installed.length, 1);
  const entries = await readdir(path.join(dir, 'units'));
  assert.deepEqual(entries.sort(), [
    'cli-heartbeat-scheduler-claude-0600.service',
    'cli-heartbeat-scheduler-claude-0600.timer',
  ]);
  const service = await readFile(result.installed[0].servicePath, 'utf8');
  assert.match(service, /run-linux\.sh/);
});

test('pruneStaleSystemdUnits removes stale scheduler-owned unit files only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-systemd-prune-'));
  const systemdUserDir = path.join(dir, 'units');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(systemdUserDir, { recursive: true }));

  const stale = path.join(systemdUserDir, 'cli-heartbeat-scheduler-old.timer');
  const staleService = path.join(systemdUserDir, 'cli-heartbeat-scheduler-old.service');
  const keep = path.join(systemdUserDir, 'cli-heartbeat-scheduler-keep.timer');
  const keepService = path.join(systemdUserDir, 'cli-heartbeat-scheduler-keep.service');
  const foreign = path.join(systemdUserDir, 'unrelated.service');
  await writeFile(stale, 'stale');
  await writeFile(staleService, 'stale');
  await writeFile(keep, 'keep');
  await writeFile(keepService, 'keep');
  await writeFile(foreign, 'foreign');

  const removed = await pruneStaleSystemdUnits({
    systemdUserDir,
    desiredUnitNames: ['cli-heartbeat-scheduler-keep'],
    unload: false,
    runner: noopRunner,
  });

  assert.deepEqual(
    removed.map((item) => path.basename(item)).sort(),
    ['cli-heartbeat-scheduler-old.service', 'cli-heartbeat-scheduler-old.timer'],
  );
  assert.equal(await readFile(keep, 'utf8'), 'keep');
  assert.equal(await readFile(foreign, 'utf8'), 'foreign');
});

test('copyLinuxRuntime copies scheduler runtime and chmods run-linux.sh', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-linux-runtime-'));
  const sourceDir = path.join(dir, 'source');
  const runtimeDir = path.join(dir, 'runtime');
  await import('node:fs/promises').then(async ({ mkdir }) => {
    await mkdir(path.join(sourceDir, 'src'), { recursive: true });
    await mkdir(path.join(sourceDir, 'scripts'), { recursive: true });
  });
  await writeFile(path.join(sourceDir, 'src', 'index.js'), 'console.log("ok")');
  await writeFile(path.join(sourceDir, 'scripts', 'run-linux.sh'), '#!/bin/sh\n');
  await writeFile(path.join(sourceDir, 'scripts', 'run-macos.sh'), '#!/bin/sh\n');
  await writeFile(path.join(sourceDir, 'package.json'), '{}');
  await writeFile(path.join(sourceDir, 'config.json'), '{"jobs":[]}');

  await copyLinuxRuntime({
    sourceDir,
    runtimeDir,
    configFile: path.join(sourceDir, 'config.json'),
  });

  assert.equal(await readFile(path.join(runtimeDir, 'src', 'index.js'), 'utf8'), 'console.log("ok")');
  assert.equal(await readFile(path.join(runtimeDir, 'config.json'), 'utf8'), '{"jobs":[]}');
});
