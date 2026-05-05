import assert from 'node:assert/strict';
import test from 'node:test';

import { nextRuns } from '../src/scheduler.js';

test('nextRuns calculates upcoming local timezone cron times', () => {
  const from = new Date('2026-05-03T23:59:10+09:00');
  const runs = nextRuns('0 9 * * *', 'Asia/Seoul', 2, from);

  assert.deepEqual(
    runs.map((run) => run.toISOString()),
    ['2026-05-04T00:00:00.000Z', '2026-05-05T00:00:00.000Z'],
  );
});

test('nextRuns supports minute steps', () => {
  const from = new Date('2026-05-03T00:00:00Z');
  const runs = nextRuns('*/15 * * * *', 'UTC', 3, from);

  assert.deepEqual(
    runs.map((run) => run.toISOString()),
    [
      '2026-05-03T00:15:00.000Z',
      '2026-05-03T00:30:00.000Z',
      '2026-05-03T00:45:00.000Z',
    ],
  );
});
