#!/usr/bin/env node
import { loadConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { defaultConfigPath, defaultLaunchAgentsDir } from './paths.js';
import { pruneStaleLaunchAgentFiles } from './platform/macos-launch-agent.js';
import { pruneStaleWindowsTasks } from './platform/windows-task-scheduler.js';
import { runJob } from './run-job.js';
import { nextRuns, startScheduler } from './scheduler.js';
import { runInteractiveSetup } from './setup.js';
import { collectStatus, formatList, formatStatus } from './status.js';
import { runDryProbe, runRealSmokeTest } from './test-runner.js';

async function main(argv) {
  const { command, flags } = parseArgs(argv);

  if (!command || flags.help) {
    printHelp();
    return;
  }

  if (command === 'setup') {
    const result = await runInteractiveSetup({
      configPath: flags.config || defaultConfigPath(),
      platform: flags.platform,
      load: flags.load !== 'false',
    });
    console.log(`Configured ${result.config.jobs.length} jobs`);
    console.log(`Config: ${result.configPath}`);
    console.log(`Runtime: ${result.runtimeDir}`);
    console.log(`Installed: ${result.installResult.installed.length}`);
    console.log(`Removed stale jobs: ${result.installResult.removed.length}`);
    printTestResult(result.testMode, result.testResult);
    return;
  }

  if (command === 'uninstall') {
    const platform = flags.platform || process.platform;
    if (platform === 'win32') {
      const removed = await pruneStaleWindowsTasks({
        unload: flags.load !== 'false',
      });
      console.log(`Removed ${removed.length} Scheduled Task(s).`);
      for (const taskName of removed) {
        console.log(`  ${taskName}`);
      }
      return;
    }

    const removed = await pruneStaleLaunchAgentFiles({
      launchAgentsDir: flags.launchAgentsDir || defaultLaunchAgentsDir(),
      desiredLabels: [],
      unload: flags.load !== 'false',
    });
    console.log(`Removed ${removed.length} LaunchAgent plist file(s).`);
    for (const file of removed) {
      console.log(`  ${file}`);
    }
    return;
  }

  if (command === 'test') {
    const mode = flags.mode || 'dry';
    const agents = flags.agents || 'claude,codex,gemini';
    if (mode === 'dry') {
      const result = await runDryProbe(agents, {
        platform: flags.platform,
      });
      if ((flags.platform || process.platform) === 'win32') {
        console.log(`Dry probe generated ${result.installed.length} task script(s) in ${result.taskScriptsDir}`);
      } else {
        console.log(`Dry probe generated ${result.installed.length} plist file(s) in ${result.launchAgentsDir}`);
      }
      return;
    }

    if (mode !== 'real') {
      throw new Error(`Unknown test mode: ${mode}`);
    }

    const config = await loadConfig(flags.config || defaultConfigPath());
    const results = await runRealSmokeTest(config, agents);
    console.log(JSON.stringify(results, null, 2));
    process.exitCode = results.every((result) => result.status === 'success') ? 0 : 1;
    return;
  }

  const config = await loadConfig(flags.config || defaultConfigPath());

  if (command === 'list') {
    console.log(formatList(config, {
      count: Number(flags.count || 1),
    }));
    return;
  }

  if (command === 'status') {
    const statuses = await collectStatus(config, {
      platform: flags.platform,
      includeLaunchctl: flags.launchctl !== 'false',
      launchAgentsDir: flags.launchAgentsDir,
    });
    console.log(formatStatus(statuses));
    return;
  }

  if (command === 'doctor') {
    const checks = await runDoctor(config);
    for (const check of checks) {
      console.log(`${check.status === 'ok' ? 'ok' : 'fail'} ${check.name}${check.message ? ` ${check.message}` : ''}`);
    }
    process.exitCode = checks.some((check) => check.status !== 'ok') ? 1 : 0;
    return;
  }

  if (command === 'next') {
    for (const job of config.jobs.filter((candidate) => candidate.enabled)) {
      const runs = nextRuns(job.schedule, config.timezone, Number(flags.count || 3));
      console.log(`${job.id}:`);
      for (const run of runs) {
        console.log(`  ${run.toISOString()}`);
      }
    }
    return;
  }

  if (command === 'run') {
    const job = config.jobs.find((candidate) => candidate.id === flags.job);
    if (!job) {
      throw new Error(`Unknown job: ${flags.job || '(missing)'}`);
    }

    const result = await runJob(config, job);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'success' ? 0 : 1;
    return;
  }

  if (command === 'start') {
    console.log(`Starting CLI Heartbeat Scheduler (${config.timezone})`);
    startScheduler(config);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv) {
  const hasTopLevelHelp = argv[0] === '--help' || argv[0] === '-h';
  const [command, ...rest] = hasTopLevelHelp ? [undefined, ...argv] : argv;
  const flags = {};

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    }
  }

  return { command, flags };
}

function printHelp() {
  console.log(`Usage:
  ./setup.sh
  node src/index.js setup [--config ~/.cli-heartbeat-scheduler/config.json]
  node src/index.js list [--config <config.json>] [--count 1]
  node src/index.js status [--config <config.json>]
  node src/index.js test [--config <config.json>] [--mode dry|real] [--agents claude,codex] [--platform win32]
  node src/index.js uninstall
  node src/index.js doctor [--config <config.json>]
  node src/index.js next [--config <config.json>] [--count 3]
  node src/index.js run --job <job-id> [--config <config.json>]
  node src/index.js start [--config <config.json>]`);
}

function printTestResult(testMode, testResult) {
  if (testMode === 'skip') {
    console.log('Test: skipped');
    return;
  }

  if (testMode === 'dry') {
    console.log(`Dry probe: ${testResult.installed.length} plist file(s) generated in ${testResult.launchAgentsDir}`);
    return;
  }

  if (testMode === 'real') {
    const ok = testResult.filter((result) => result.status === 'success').length;
    console.log(`Real smoke test: ${ok}/${testResult.length} succeeded`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
