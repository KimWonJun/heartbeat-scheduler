import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTime, parseTimeList, timeToCron } from '../src/time.js';

test('parseTime accepts strict HH:MM values', () => {
  assert.deepEqual(parseTime('00:00'), { hour: 0, minute: 0, value: '00:00' });
  assert.deepEqual(parseTime('06:05'), { hour: 6, minute: 5, value: '06:05' });
  assert.deepEqual(parseTime('23:59'), { hour: 23, minute: 59, value: '23:59' });
});

test('parseTime rejects loose or out-of-range values', () => {
  for (const value of ['6:00', '06:0', '24:00', '23:60', 'aa:bb', '', '06:00:00']) {
    assert.throws(() => parseTime(value), /HH:MM|hour|minute|time/i);
  }
});

test('parseTimeList trims, deduplicates, and sorts times', () => {
  assert.deepEqual(parseTimeList('11:00, 06:00,16:00,06:00'), ['06:00', '11:00', '16:00']);
  assert.deepEqual(parseTimeList(['23:00', '00:30', '23:00']), ['00:30', '23:00']);
});

test('parseTimeList requires at least one time', () => {
  assert.throws(() => parseTimeList(''), /at least one/i);
  assert.throws(() => parseTimeList([]), /at least one/i);
});

test('timeToCron converts HH:MM to five-field cron', () => {
  assert.equal(timeToCron('06:05'), '5 6 * * *');
  assert.equal(timeToCron('16:00'), '0 16 * * *');
});
