import { runJob } from './run-job.js';

const FIELD_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

export function validateCronExpression(expression) {
  parseCronExpression(expression);
}

export function nextRuns(expression, timezone, count = 5, from = new Date()) {
  const cron = parseCronExpression(expression);
  const runs = [];
  let cursor = floorToNextMinute(from);
  const maxIterations = 527_040;

  for (let i = 0; i < maxIterations && runs.length < count; i += 1) {
    const parts = getZonedParts(cursor, timezone);
    if (matchesCron(cron, parts)) {
      runs.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }

  if (runs.length < count) {
    throw new Error(`Could not calculate next runs for cron expression: ${expression}`);
  }

  return runs;
}

export function startScheduler(config, options = {}) {
  const timers = [];
  const logger = options.logger || console;

  for (const job of config.jobs.filter((candidate) => candidate.enabled)) {
    scheduleJob(config, job, timers, logger);
  }

  return {
    stop() {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    },
  };
}

function scheduleJob(config, job, timers, logger) {
  const [nextRun] = nextRuns(job.schedule, config.timezone, 1);
  const delayMs = Math.max(0, nextRun.getTime() - Date.now());

  logger.log(`[${job.id}] next run: ${nextRun.toISOString()}`);
  const timer = setTimeout(async () => {
    try {
      const result = await runJob(config, job, { scheduledAt: nextRun });
      logger.log(`[${job.id}] ${result.status} (${result.durationMs}ms)`);
    } catch (error) {
      logger.error(`[${job.id}] scheduler error: ${error.stack || error.message}`);
    } finally {
      scheduleJob(config, job, timers, logger);
    }
  }, delayMs);

  timers.push(timer);
}

function parseCronExpression(expression) {
  if (typeof expression !== 'string') {
    throw new Error('Cron expression must be a string');
  }

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have five fields: ${expression}`);
  }

  return fields.map((field, index) => parseCronField(field, FIELD_RANGES[index]));
}

function parseCronField(field, [min, max]) {
  const values = new Set();
  const parts = field.split(',');

  for (const part of parts) {
    addCronPart(values, part, min, max);
  }

  if (values.size === 0) {
    throw new Error(`Empty cron field: ${field}`);
  }

  return values;
}

function addCronPart(values, part, min, max) {
  const [rangePart, stepPart] = part.split('/');
  const step = stepPart === undefined ? 1 : Number(stepPart);
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`Invalid cron step: ${part}`);
  }

  let start;
  let end;
  if (rangePart === '*') {
    start = min;
    end = max;
  } else if (rangePart.includes('-')) {
    const [rawStart, rawEnd] = rangePart.split('-').map(Number);
    start = rawStart;
    end = rawEnd;
  } else {
    start = Number(rangePart);
    end = Number(rangePart);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
    throw new Error(`Invalid cron range: ${part}`);
  }

  for (let value = start; value <= end; value += step) {
    values.add(value);
  }
}

function matchesCron(cron, parts) {
  const [minutes, hours, days, months, weekdays] = cron;
  const weekdayMatches = weekdays.has(parts.weekday) || (parts.weekday === 0 && weekdays.has(7));

  return (
    minutes.has(parts.minute) &&
    hours.has(parts.hour) &&
    days.has(parts.day) &&
    months.has(parts.month) &&
    weekdayMatches
  );
}

function floorToNextMinute(date) {
  const next = new Date(date);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);
  return next;
}

function getZonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: weekdayToNumber(parts.weekday),
  };
}

function weekdayToNumber(value) {
  return {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }[value];
}
