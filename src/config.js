import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expandScheduleProfile, normalizeScheduleProfile } from './schedule-profile.js';
import { validateCronExpression } from './scheduler.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 20_000;
const DEFAULT_ROOT_DIR = '~/.cli-heartbeat-scheduler';
const PROVIDERS = new Set(['claude', 'codex', 'gemini']);

export function expandHome(value) {
  if (typeof value !== 'string') {
    return value;
  }

  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

export function resolveUserPath(value, baseDir = process.cwd()) {
  const expanded = expandHome(value);
  return path.resolve(baseDir, expanded);
}

export async function loadConfig(configPath) {
  if (!configPath) {
    throw new Error('Missing --config <path>');
  }

  const absoluteConfigPath = path.resolve(configPath);
  const raw = await readFile(absoluteConfigPath, 'utf8');
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON config: ${error.message}`);
  }

  return normalizeConfig(parsed, path.dirname(absoluteConfigPath));
}

export function normalizeConfig(parsed, baseDir = process.cwd()) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Config must be a JSON object');
  }

  const timezone = parsed.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  validateTimezone(timezone);

  const defaultTimeoutMs = validatePositiveInteger(
    parsed.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    'defaultTimeoutMs',
  );
  const maxOutputBytes = validatePositiveInteger(
    parsed.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    'maxOutputBytes',
  );
  const rootDir = resolveUserPath(parsed.rootDir || DEFAULT_ROOT_DIR, baseDir);
  const workdir = resolveUserPath(parsed.workdir || path.join(rootDir, 'workdir'), baseDir);
  const logDir = resolveUserPath(parsed.logDir || path.join(rootDir, 'logs'), baseDir);
  const stateDir = resolveUserPath(parsed.stateDir || path.join(rootDir, 'state'), baseDir);

  const generatedJobs = parsed.scheduleProfile
    ? expandScheduleProfile(parsed.scheduleProfile)
    : [];
  const explicitJobs = parsed.jobs ?? [];

  if (!Array.isArray(explicitJobs)) {
    throw new Error('Config jobs must be an array when provided');
  }

  if (generatedJobs.length === 0 && explicitJobs.length === 0) {
    throw new Error('Config requires at least one job');
  }

  const seenIds = new Set();
  const jobs = [...generatedJobs, ...explicitJobs].map((job, index) => {
    const normalized = normalizeJob(job, index, {
      defaultTimeoutMs,
      workdir,
    });

    if (seenIds.has(normalized.id)) {
      throw new Error(`Duplicate job id: ${normalized.id}`);
    }
    seenIds.add(normalized.id);

    return normalized;
  });

  return {
    timezone,
    rootDir,
    workdir,
    logDir,
    stateDir,
    defaultTimeoutMs,
    maxOutputBytes,
    scheduleProfile: parsed.scheduleProfile ? normalizeScheduleProfile(parsed.scheduleProfile) : undefined,
    jobs,
  };
}

function normalizeJob(job, index, defaults) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw new Error(`jobs[${index}] must be an object`);
  }

  const id = requireString(job.id, `jobs[${index}].id`);
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`Invalid job id "${id}". Use letters, numbers, dot, underscore, or dash.`);
  }

  const provider = requireString(job.provider, `jobs[${index}].provider`);
  if (!PROVIDERS.has(provider)) {
    throw new Error(`Unsupported provider for job "${id}": ${provider}`);
  }

  const schedule = requireString(job.schedule, `jobs[${index}].schedule`);
  validateCronExpression(schedule);

  const prompt = requireString(job.prompt, `jobs[${index}].prompt`);
  const timeoutMs = validatePositiveInteger(job.timeoutMs ?? defaults.defaultTimeoutMs, `${id}.timeoutMs`);
  const workdir = job.workdir ? resolveUserPath(job.workdir) : defaults.workdir;
  const extraArgs = validateStringArray(job.extraArgs ?? [], `${id}.extraArgs`);
  const commandArgs = job.commandArgs
    ? validateStringArray(job.commandArgs, `${id}.commandArgs`)
    : undefined;

  return {
    id,
    provider,
    schedule,
    prompt,
    enabled: job.enabled !== false,
    timeoutMs,
    workdir,
    extraArgs,
    commandArgs,
    recurrence: job.recurrence,
    command: typeof job.command === 'string' && job.command.length > 0 ? job.command : undefined,
  };
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
}

function validateStringArray(value, name) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be an array of strings`);
  }

  return value;
}

function validatePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function validateTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
}
