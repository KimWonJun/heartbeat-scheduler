const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTime(value) {
  if (typeof value !== 'string') {
    throw new Error('Time must be a string in HH:MM format');
  }

  const match = TIME_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid time "${value}". Expected HH:MM with hour 00-23 and minute 00-59.`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  return {
    hour,
    minute,
    value: `${match[1]}:${match[2]}`,
  };
}

export function parseTimeList(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const seen = new Map();
  for (const raw of rawValues) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) {
      continue;
    }

    const parsed = parseTime(trimmed);
    seen.set(parsed.value, parsed);
  }

  if (seen.size === 0) {
    throw new Error('At least one run time is required');
  }

  return [...seen.values()]
    .sort((left, right) => left.hour - right.hour || left.minute - right.minute)
    .map((time) => time.value);
}

export function timeToCron(value, weekdayCron = '*') {
  const time = parseTime(value);
  return `${time.minute} ${time.hour} * * ${weekdayCron}`;
}

export function timeToJobSuffix(value) {
  const time = parseTime(value);
  return `${String(time.hour).padStart(2, '0')}${String(time.minute).padStart(2, '0')}`;
}
