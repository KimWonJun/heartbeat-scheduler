import { checkbox, input, select } from '@inquirer/prompts';

import { loadConfig } from './config.js';
import {
  defaultConfigPath,
  defaultLaunchAgentsDir,
  defaultRuntimeConfigPath,
  defaultRuntimeDir,
  defaultSystemdUserDir,
} from './paths.js';
import { buildConfigFromSetupAnswers, installConfiguredSchedule } from './setup-core.js';
import { runDryProbe, runRealSmokeTest } from './test-runner.js';
import { parseTimeList } from './time.js';

const AGENT_CHOICES = [
  { name: 'Claude Code', value: 'claude' },
  { name: 'Codex', value: 'codex' },
  { name: 'Gemini CLI', value: 'gemini' },
];

const WEEKDAY_CHOICES = [
  { name: 'Monday', value: 'mon' },
  { name: 'Tuesday', value: 'tue' },
  { name: 'Wednesday', value: 'wed' },
  { name: 'Thursday', value: 'thu' },
  { name: 'Friday', value: 'fri' },
  { name: 'Saturday', value: 'sat' },
  { name: 'Sunday', value: 'sun' },
];

export async function runInteractiveSetup(options = {}) {
  const platform = options.platform || process.platform;
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`Interactive setup does not support platform: ${platform}`);
  }

  const configPath = options.configPath || defaultConfigPath();
  const runtimeDir = options.runtimeDir || defaultRuntimeDir();
  const runtimeConfigPath = options.runtimeConfigPath || defaultRuntimeConfigPath();
  const launchAgentsDir = options.launchAgentsDir || defaultLaunchAgentsDir();
  const systemdUserDir = options.systemdUserDir || defaultSystemdUserDir();
  const defaults = await loadSetupDefaults(configPath);

  const agents = await checkbox({
    message: 'AI agents to schedule',
    choices: AGENT_CHOICES.map((choice) => ({
      ...choice,
      checked: defaults.agents.includes(choice.value),
    })),
    required: true,
  });

  const times = await input({
    message: 'Run times in KST (HH:MM, comma-separated)',
    default: defaults.times.join(','),
    validate(value) {
      try {
        parseTimeList(value);
        return true;
      } catch (error) {
        return error.message;
      }
    },
  });

  const recurrenceType = await select({
    message: 'Schedule type',
    default: defaults.recurrenceType,
    choices: [
      { name: 'One shot', value: 'once' },
      { name: 'Every day', value: 'daily' },
      { name: 'Selected weekdays', value: 'weekdays' },
    ],
  });

  let weekdays = defaults.weekdays;
  if (recurrenceType === 'weekdays') {
    weekdays = await checkbox({
      message: 'Weekdays',
      choices: WEEKDAY_CHOICES.map((choice) => ({
        ...choice,
        checked: defaults.weekdays.includes(choice.value),
      })),
      required: true,
    });
  }

  const prompt = await input({
    message: 'Prompt',
    default: defaults.prompt,
    validate(value) {
      return value.trim() ? true : 'Prompt is required';
    },
  });

  const testMode = await select({
    message: 'Test after setup?',
    default: 'dry',
    choices: [
      { name: 'Dry launchd probe (no provider call)', value: 'dry' },
      { name: 'No test', value: 'skip' },
      { name: 'Real provider smoke test now', value: 'real' },
    ],
  });

  const config = buildConfigFromSetupAnswers({
    agents,
    times,
    recurrenceType,
    weekdays,
    prompt,
  });

  const installResult = await installConfiguredSchedule(config, {
    sourceDir: options.sourceDir || process.cwd(),
    configPath,
    runtimeDir,
    runtimeConfigPath,
    launchAgentsDir,
    systemdUserDir,
    runScriptPath: options.runScriptPath,
    platform,
    load: options.load,
  });

  const testResult = await runSelectedTest(testMode, config, agents);

  return {
    config,
    configPath,
    runtimeDir,
    installResult,
    testMode,
    testResult,
  };
}

async function runSelectedTest(testMode, config, agents) {
  if (testMode === 'dry') {
    return runDryProbe(agents);
  }

  if (testMode === 'real') {
    return runRealSmokeTest(config, agents);
  }

  return undefined;
}

async function loadSetupDefaults(configPath) {
  try {
    const config = await loadConfig(configPath);
    return defaultsFromConfig(config);
  } catch {
    return {
      agents: ['claude', 'codex'],
      times: ['06:00', '11:00', '16:00'],
      recurrenceType: 'daily',
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      prompt: 'test! 출력',
    };
  }
}

function defaultsFromConfig(config) {
  if (config.scheduleProfile) {
    return {
      agents: config.scheduleProfile.agents,
      times: config.scheduleProfile.times,
      recurrenceType: config.scheduleProfile.recurrence.type,
      weekdays: config.scheduleProfile.recurrence.weekdays || ['mon', 'tue', 'wed', 'thu', 'fri'],
      prompt: config.scheduleProfile.prompt,
    };
  }

  const jobs = config.jobs.filter((job) => job.enabled !== false);
  const agents = [...new Set(jobs.map((job) => job.provider))].sort();
  const times = parseTimeList(jobs.map((job) => timeFromCron(job.schedule)).filter(Boolean));
  const recurrenceTypes = new Set(jobs.map((job) => job.recurrence?.type || 'daily'));
  const recurrenceType = recurrenceTypes.has('weekdays')
    ? 'weekdays'
    : recurrenceTypes.has('once')
      ? 'once'
      : 'daily';
  const weekdays = [...new Set(jobs.flatMap((job) => job.recurrence?.weekdays || []))].sort();

  return {
    agents: agents.length > 0 ? agents : ['claude', 'codex'],
    times,
    recurrenceType,
    weekdays: weekdays.length > 0 ? weekdays : ['mon', 'tue', 'wed', 'thu', 'fri'],
    prompt: jobs[0]?.prompt || 'test! 출력',
  };
}

function timeFromCron(schedule) {
  const [minute, hour] = schedule.trim().split(/\s+/);
  if (!/^\d+$/.test(hour) || !/^\d+$/.test(minute)) {
    return undefined;
  }

  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}
