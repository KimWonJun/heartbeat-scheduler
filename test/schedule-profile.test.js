import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expandScheduleProfile,
  normalizeScheduleProfile,
} from '../src/schedule-profile.js';
import { normalizeConfig } from '../src/config.js';

test('normalizeScheduleProfile validates agents, times, recurrence, and prompt defaults', () => {
  const profile = normalizeScheduleProfile({
    agents: ['codex', 'claude', 'codex'],
    times: '11:00,06:00,16:00',
    recurrence: { type: 'daily' },
  });

  assert.deepEqual(profile.agents, ['claude', 'codex']);
  assert.deepEqual(profile.times, ['06:00', '11:00', '16:00']);
  assert.deepEqual(profile.recurrence, { type: 'daily' });
  assert.equal(profile.prompt, 'test! 출력');
});

test('normalizeScheduleProfile supports selected weekdays', () => {
  const profile = normalizeScheduleProfile({
    agents: ['gemini'],
    times: ['09:30'],
    recurrence: { type: 'weekdays', weekdays: ['fri', 'mon', 'mon'] },
    prompt: 'ping',
  });

  assert.deepEqual(profile.agents, ['gemini']);
  assert.deepEqual(profile.times, ['09:30']);
  assert.deepEqual(profile.recurrence, { type: 'weekdays', weekdays: ['mon', 'fri'] });
  assert.equal(profile.prompt, 'ping');
});

test('normalizeScheduleProfile rejects invalid profiles', () => {
  assert.throws(() => normalizeScheduleProfile({ agents: [], times: ['06:00'] }), /agent/i);
  assert.throws(() => normalizeScheduleProfile({ agents: ['bad'], times: ['06:00'] }), /Unsupported agent/i);
  assert.throws(
    () => normalizeScheduleProfile({ agents: ['claude'], times: ['06:00'], recurrence: { type: 'weekdays' } }),
    /weekday/i,
  );
});

test('expandScheduleProfile creates stable jobs for each agent and time', () => {
  const jobs = expandScheduleProfile({
    agents: ['claude', 'codex', 'gemini'],
    times: ['06:00', '11:00'],
    recurrence: { type: 'daily' },
    prompt: 'test! 출력',
  });

  assert.deepEqual(
    jobs.map((job) => [job.id, job.provider, job.schedule, job.prompt]),
    [
      ['claude-0600', 'claude', '0 6 * * *', 'test! 출력'],
      ['claude-1100', 'claude', '0 11 * * *', 'test! 출력'],
      ['codex-0600', 'codex', '0 6 * * *', 'test! 출력'],
      ['codex-1100', 'codex', '0 11 * * *', 'test! 출력'],
      ['gemini-0600', 'gemini', '0 6 * * *', 'test! 출력'],
      ['gemini-1100', 'gemini', '0 11 * * *', 'test! 출력'],
    ],
  );
});

test('expandScheduleProfile preserves weekday recurrence metadata on jobs', () => {
  const [job] = expandScheduleProfile({
    agents: ['claude'],
    times: ['16:05'],
    recurrence: { type: 'weekdays', weekdays: ['mon', 'wed'] },
    prompt: 'hello',
  });

  assert.equal(job.id, 'claude-1605');
  assert.equal(job.schedule, '5 16 * * 1,3');
  assert.deepEqual(job.recurrence, { type: 'weekdays', weekdays: ['mon', 'wed'] });
});

test('normalizeConfig expands scheduleProfile into existing jobs contract', () => {
  const config = normalizeConfig({
    timezone: 'Asia/Seoul',
    scheduleProfile: {
      agents: ['claude', 'codex'],
      times: ['06:00', '11:00', '16:00'],
      recurrence: { type: 'daily' },
      prompt: 'test! 출력',
    },
  });

  assert.deepEqual(config.scheduleProfile.agents, ['claude', 'codex']);
  assert.equal(config.jobs.length, 6);
  assert.deepEqual(
    config.jobs.map((job) => job.id),
    ['claude-0600', 'claude-1100', 'claude-1600', 'codex-0600', 'codex-1100', 'codex-1600'],
  );
});

test('normalizeConfig allows explicit jobs to coexist with generated jobs', () => {
  const config = normalizeConfig({
    scheduleProfile: {
      agents: ['gemini'],
      times: ['09:00'],
      recurrence: { type: 'once' },
      prompt: 'profile',
    },
    jobs: [
      {
        id: 'manual-claude',
        provider: 'claude',
        schedule: '0 5 * * *',
        prompt: 'manual',
      },
    ],
  });

  assert.deepEqual(config.jobs.map((job) => job.id), ['gemini-0900', 'manual-claude']);
  assert.equal(config.jobs[0].recurrence.type, 'once');
});
