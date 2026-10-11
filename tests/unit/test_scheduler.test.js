'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerSchedules } = require('../../index.js');

function makeFakeCron({ valid = true } = {}) {
  const jobs = [];
  return {
    jobs,
    validate: (expr) => valid && typeof expr === 'string' && expr.trim().split(/\s+/).length === 5,
    schedule(expr, fn) {
      const job = { expr, fn, stopped: false, stop() { this.stopped = true; } };
      jobs.push(job);
      return job;
    }
  };
}

test('registers exactly one job per schedule with its cron expression', () => {
  const cron = makeFakeCron();
  const schedules = [
    { cron: '0 12 * * *', dishIds: ['a'] },
    { cron: '30 19 * * *', dishIds: ['b', 'c'] }
  ];
  const handle = registerSchedules(schedules, cron, () => {});
  assert.equal(cron.jobs.length, 2);
  assert.equal(cron.jobs[0].expr, '0 12 * * *');
  assert.equal(cron.jobs[1].expr, '30 19 * * *');
  handle.stop();
});

test('registration never fires the handler (missed schedules omitted, no backfill)', () => {
  const cron = makeFakeCron();
  let calls = 0;
  registerSchedules([{ cron: '0 12 * * *', dishIds: ['a'] }], cron, () => { calls += 1; });
  assert.equal(calls, 0, 'past occurrences must never be replayed at startup');
});

test('handler fires only when the scheduler triggers, receiving the schedule', () => {
  const cron = makeFakeCron();
  const fired = [];
  registerSchedules([{ cron: '0 12 * * *', dishIds: ['a'] }], cron, (s) => fired.push(s));
  assert.equal(fired.length, 0);
  cron.jobs[0].fn();
  cron.jobs[0].fn();
  assert.equal(fired.length, 2);
  assert.deepEqual(fired[0], { cron: '0 12 * * *', dishIds: ['a'] });
});

test('invalid cron expression is rejected with config-invalida (FR-004)', () => {
  const cron = makeFakeCron();
  assert.throws(
    () => registerSchedules([{ cron: 'not-a-cron', dishIds: ['a'] }], cron, () => {}),
    (err) => err.motivo === 'config-invalida'
  );
  assert.equal(cron.jobs.length, 0, 'no job must be registered on invalid config');
});

test('stop() stops every registered job', () => {
  const cron = makeFakeCron();
  const handle = registerSchedules(
    [{ cron: '0 12 * * *', dishIds: ['a'] }, { cron: '0 19 * * *', dishIds: ['b'] }],
    cron,
    () => {}
  );
  handle.stop();
  assert.ok(cron.jobs.every((j) => j.stopped));
});

test('empty schedules registers nothing (silent-wait mode, quickstart S12)', () => {
  const cron = makeFakeCron();
  const handle = registerSchedules([], cron, () => {});
  assert.equal(cron.jobs.length, 0);
  handle.stop();
});
