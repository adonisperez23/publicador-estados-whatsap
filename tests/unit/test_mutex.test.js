'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMutex } = require('../../index.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('tasks run strictly sequentially — zero concurrency (FR-013)', async () => {
  const mutex = createMutex({ intervalMs: 0 });
  const events = [];
  let active = 0;
  let maxActive = 0;

  const task = (id, ms) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${id}`);
    await sleep(ms);
    events.push(`end:${id}`);
    active -= 1;
    return id;
  };

  const results = await Promise.all([
    mutex.run(task('a', 30)),
    mutex.run(task('b', 10)),
    mutex.run(task('c', 10))
  ]);

  assert.equal(maxActive, 1, 'never two tasks active at once');
  assert.deepEqual(results, ['a', 'b', 'c'], 'FIFO order preserved');
  assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
});

test('publishIntervalSeconds respected between consecutive publications (FR-015)', async () => {
  const intervalMs = 60;
  const mutex = createMutex({ intervalMs });
  const marks = [];

  await mutex.run(async () => { marks.push({ op: 'start', t: Date.now() }); await sleep(10); marks.push({ op: 'end', t: Date.now() }); });
  await mutex.run(async () => { marks.push({ op: 'start', t: Date.now() }); await sleep(10); marks.push({ op: 'end', t: Date.now() }); });
  await mutex.run(async () => { marks.push({ op: 'start', t: Date.now() }); await sleep(10); marks.push({ op: 'end', t: Date.now() }); });

  const starts = marks.filter((m) => m.op === 'start');
  const ends = marks.filter((m) => m.op === 'end');
  assert.ok(starts[1].t - ends[0].t >= intervalMs - 5, `gap ${starts[1].t - ends[0].t}ms >= ${intervalMs}ms`);
  assert.ok(starts[2].t - ends[1].t >= intervalMs - 5, `gap ${starts[2].t - ends[1].t}ms >= ${intervalMs}ms`);
});

test('first publication is not delayed by the interval', async () => {
  const mutex = createMutex({ intervalMs: 5000 });
  const t0 = Date.now();
  await mutex.run(async () => {});
  assert.ok(Date.now() - t0 < 1000, 'no interval wait before the very first publication');
});

test('a failing attempt does not block subsequent publications (FR-011)', async () => {
  const mutex = createMutex({ intervalMs: 0 });
  const boom = new Error('fallo de red');
  const outcome = await mutex.run(async () => { throw boom; }).catch((e) => e);
  assert.equal(outcome, boom);
  const next = await mutex.run(async () => 'siguiente-horario');
  assert.equal(next, 'siguiente-horario');
});

test('overlapping schedule fires are queued, never interleaved (edge case: dos horarios coinciden)', async () => {
  const mutex = createMutex({ intervalMs: 20 });
  const log = [];
  const band = (name) => async () => {
    log.push(`${name}-1`);
    await sleep(15);
    log.push(`${name}-2`);
  };
  await Promise.all([mutex.run(band('bandA')), mutex.run(band('bandB'))]);
  const a1 = log.indexOf('bandA-1');
  const a2 = log.indexOf('bandA-2');
  assert.ok(a2 > a1);
  const b1 = log.indexOf('bandB-1');
  assert.ok(b1 > a2, 'second band starts only after the first fully completes');
});
