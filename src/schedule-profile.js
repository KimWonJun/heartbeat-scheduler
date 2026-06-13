import { parseTimeList, timeToCron, timeToJobSuffix } from './time.js';

export const SUPPORTED_AGENTS = ['claude', 'codex', 'antigravity'];
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_PROMPT = 'test! 출력';
const DEFAULT_RECURRENCE = { type: 'once' };
const WEEKDAY_CRON_VALUES = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function normalizeScheduleProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('scheduleProfile must be an object');
  }

  const agents = normalizeAgents(profile.agents);
  const times = parseTimeList(profile.times);
  const recurrence = normalizeRecurrence(profile.recurrence ?? DEFAULT_RECURRENCE);
  const prompt = typeof profile.prompt === 'string' && profile.prompt.trim()
    ? profile.prompt
    : DEFAULT_PROMPT;

  return {
    agents,
    times,
    recurrence,
    prompt,
  };
}

export function expandScheduleProfile(profile) {
  const normalized = normalizeScheduleProfile(profile);
  const jobs = [];
  const weekdayCron = recurrenceToWeekdayCron(normalized.recurrence);

  for (const agent of normalized.agents) {
    for (const time of normalized.times) {
      jobs.push({
        id: `${agent}-${timeToJobSuffix(time)}`,
        provider: agent,
        schedule: timeToCron(time, weekdayCron),
        prompt: normalized.prompt,
        enabled: true,
        recurrence: normalized.recurrence,
      });
    }
  }

  return jobs;
}

function normalizeAgents(value) {
  if (!Array.isArray(value)) {
    throw new Error('scheduleProfile.agents must be an array');
  }

  const selected = [];
  for (const agent of value) {
    if (typeof agent !== 'string' || !SUPPORTED_AGENTS.includes(agent)) {
      throw new Error(`Unsupported agent: ${agent}`);
    }
    if (!selected.includes(agent)) {
      selected.push(agent);
    }
  }

  if (selected.length === 0) {
    throw new Error('At least one agent is required');
  }

  return SUPPORTED_AGENTS.filter((agent) => selected.includes(agent));
}

function normalizeRecurrence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('scheduleProfile.recurrence must be an object');
  }

  if (value.type === 'once') {
    return { type: 'once' };
  }

  if (value.type === 'daily') {
    return { type: 'daily' };
  }

  if (value.type === 'weekdays') {
    const weekdays = normalizeWeekdays(value.weekdays);
    return { type: 'weekdays', weekdays };
  }

  throw new Error(`Unsupported recurrence type: ${value.type}`);
}

function normalizeWeekdays(value) {
  if (!Array.isArray(value)) {
    throw new Error('Selected weekday recurrence requires weekdays');
  }

  const selected = [];
  for (const weekday of value) {
    if (typeof weekday !== 'string' || !WEEKDAYS.includes(weekday)) {
      throw new Error(`Unsupported weekday: ${weekday}`);
    }
    if (!selected.includes(weekday)) {
      selected.push(weekday);
    }
  }

  if (selected.length === 0) {
    throw new Error('Selected weekday recurrence requires at least one weekday');
  }

  return WEEKDAYS.filter((weekday) => selected.includes(weekday));
}

function recurrenceToWeekdayCron(recurrence) {
  if (recurrence.type === 'weekdays') {
    return recurrence.weekdays.map((weekday) => WEEKDAY_CRON_VALUES[weekday]).join(',');
  }

  return '*';
}
