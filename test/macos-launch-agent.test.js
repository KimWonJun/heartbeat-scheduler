import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildLaunchAgentPlist,
  copyRuntime,
  desiredLaunchAgents,
  installLaunchAgentFiles,
  launchdWeekday,
  pruneStaleLaunchAgentFiles,
} from '../src/platform/macos-launch-agent.js';

test('buildLaunchAgentPlist creates one-shot plist with once wrapper mode', () => {
  const plist = buildLaunchAgentPlist({
    label: 'com.local.cli-heartbeat-scheduler.claude-0600',
    projectDir: '/Users/me/.cli-heartbeat-scheduler/app',
    configPath: '/Users/me/.cli-heartbeat-scheduler/app/config.json',
    job: {
      id: 'claude-custom',
      schedule: '0 6 * * *',
      recurrence: { type: 'once' },
    },
    plistPath: '/Users/me/Library/LaunchAgents/com.local.cli-heartbeat-scheduler.claude-0600.plist',
    runScriptPath: '/Users/me/.cli-heartbeat-scheduler/app/scripts/run-macos.sh',
    nodeBin: '/opt/homebrew/bin/node',
    logDir: '/Users/me/.cli-heartbeat-scheduler/logs',
  });

  assert.match(plist, /<string>once<\/string>/);
  assert.match(plist, /<key>Hour<\/key>\s*<integer>6<\/integer>/);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>0<\/integer>/);
  assert.match(plist, /claude-custom\.launchd\.out\.log/);
});

test('buildLaunchAgentPlist creates persistent daily plist', () => {
  const plist = buildLaunchAgentPlist({
    label: 'com.local.cli-heartbeat-scheduler.codex-1115',
    projectDir: '/app',
    configPath: '/app/config.json',
    job: {
      id: 'codex-1115',
      recurrence: { type: 'daily' },
    },
    plistPath: '/LaunchAgents/com.local.cli-heartbeat-scheduler.codex-1115.plist',
    runScriptPath: '/app/scripts/run-macos.sh',
    nodeBin: '/node',
    logDir: '/logs',
  });

  assert.match(plist, /<string>persistent<\/string>/);
  assert.match(plist, /<key>Hour<\/key>\s*<integer>11<\/integer>/);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>15<\/integer>/);
  assert.doesNotMatch(plist, /<key>Weekday<\/key>/);
});

test('buildLaunchAgentPlist creates persistent selected-weekday plist array', () => {
  const plist = buildLaunchAgentPlist({
    label: 'com.local.cli-heartbeat-scheduler.gemini-1605',
    projectDir: '/app',
    configPath: '/app/config.json',
    job: {
      id: 'gemini-1605',
      recurrence: { type: 'weekdays', weekdays: ['mon', 'wed', 'fri'] },
    },
    plistPath: '/LaunchAgents/com.local.cli-heartbeat-scheduler.gemini-1605.plist',
    runScriptPath: '/app/scripts/run-macos.sh',
    nodeBin: '/node',
    logDir: '/logs',
  });

  assert.match(plist, /<string>persistent<\/string>/);
  assert.equal([...plist.matchAll(/<key>Weekday<\/key>/g)].length, 3);
  assert.match(plist, /<integer>1<\/integer>/);
  assert.match(plist, /<integer>3<\/integer>/);
  assert.match(plist, /<integer>5<\/integer>/);
});

test('launchdWeekday maps sunday through saturday for macOS launchd', () => {
  assert.equal(launchdWeekday('sun'), 0);
  assert.equal(launchdWeekday('mon'), 1);
  assert.equal(launchdWeekday('sat'), 6);
});

test('desiredLaunchAgents creates labels and plist paths for enabled jobs only', () => {
  const agents = desiredLaunchAgents(
    {
      jobs: [
        { id: 'claude-0600', enabled: true, recurrence: { type: 'daily' } },
        { id: 'codex-1100', enabled: false, recurrence: { type: 'daily' } },
      ],
      logDir: '/logs',
    },
    {
      launchAgentsDir: '/LaunchAgents',
      runtimeDir: '/runtime',
      configPath: '/runtime/config.json',
      nodeBin: '/node',
    },
  );

  assert.equal(agents.length, 1);
  assert.equal(agents[0].label, 'com.local.cli-heartbeat-scheduler.claude-0600');
  assert.equal(agents[0].plistPath, '/LaunchAgents/com.local.cli-heartbeat-scheduler.claude-0600.plist');
});

test('installLaunchAgentFiles writes desired plist files without launchctl when load is false', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-launch-agent-'));
  const result = await installLaunchAgentFiles(
    {
      jobs: [{ id: 'claude-0600', enabled: true, recurrence: { type: 'daily' } }],
      logDir: path.join(dir, 'logs'),
    },
    {
      launchAgentsDir: path.join(dir, 'LaunchAgents'),
      runtimeDir: path.join(dir, 'runtime'),
      configPath: path.join(dir, 'runtime', 'config.json'),
      runScriptPath: path.join(dir, 'runtime', 'scripts', 'run-macos.sh'),
      nodeBin: process.execPath,
      load: false,
    },
  );

  assert.equal(result.installed.length, 1);
  const plist = await readFile(result.installed[0].plistPath, 'utf8');
  assert.match(plist, /claude-0600/);
});

test('pruneStaleLaunchAgentFiles removes stale scheduler-owned plist files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-prune-'));
  const launchAgentsDir = path.join(dir, 'LaunchAgents');
  await writeFile(path.join(dir, 'keep.txt'), 'ignore');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(launchAgentsDir, { recursive: true }));

  const stale = path.join(launchAgentsDir, 'com.local.cli-heartbeat-scheduler.old.plist');
  const keep = path.join(launchAgentsDir, 'com.local.cli-heartbeat-scheduler.keep.plist');
  const foreign = path.join(launchAgentsDir, 'com.local.other.plist');
  await writeFile(stale, 'stale');
  await writeFile(keep, 'keep');
  await writeFile(foreign, 'foreign');

  const removed = await pruneStaleLaunchAgentFiles({
    launchAgentsDir,
    desiredLabels: ['com.local.cli-heartbeat-scheduler.keep'],
    unload: false,
  });

  assert.deepEqual(removed.map((item) => path.basename(item)), ['com.local.cli-heartbeat-scheduler.old.plist']);
  assert.equal(await readFile(keep, 'utf8'), 'keep');
  assert.equal(await readFile(foreign, 'utf8'), 'foreign');
});

test('copyRuntime copies executable scheduler runtime to a safe runtime directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chs-runtime-'));
  const sourceDir = path.join(dir, 'source');
  const runtimeDir = path.join(dir, 'runtime');
  await import('node:fs/promises').then(async ({ mkdir }) => {
    await mkdir(path.join(sourceDir, 'src'), { recursive: true });
    await mkdir(path.join(sourceDir, 'scripts'), { recursive: true });
  });
  await writeFile(path.join(sourceDir, 'src', 'index.js'), 'console.log("ok")');
  await writeFile(path.join(sourceDir, 'scripts', 'run-macos.sh'), '#!/bin/sh\n');
  await writeFile(path.join(sourceDir, 'package.json'), '{}');
  await writeFile(path.join(sourceDir, 'config.json'), '{"jobs":[]}');

  await copyRuntime({
    sourceDir,
    runtimeDir,
    configFile: path.join(sourceDir, 'config.json'),
  });

  assert.equal(await readFile(path.join(runtimeDir, 'src', 'index.js'), 'utf8'), 'console.log("ok")');
  assert.equal(await readFile(path.join(runtimeDir, 'config.json'), 'utf8'), '{"jobs":[]}');
});
