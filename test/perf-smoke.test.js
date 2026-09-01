// A catastrophe detector, not a benchmark.
//
// The thresholds below are roughly 20x slower than what this library actually achieves, so
// they will not flicker on a loaded CI box, a cold cache, or a different engine. They exist
// to catch the kind of regression that changes the shape of the code — an accidental O(n)
// scan, a cache that stopped caching, a fast path that stopped being taken — not to police
// a few percent. Real numbers come from `npm run bench`, which isolates each measurement in
// its own process; nothing here is precise enough to publish.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseISO, toISO, toISODate, addDays, addMonths, startOfDay } from '../lib/core.js';
import { offsetAt, zoneStats, resetZoneCaches } from '../lib/zone.js';
import { clustered, scattered } from './helpers.js';

/** Median ops/sec over a few short passes. Deliberately crude. */
function opsPerSec(fn, iterations = 20_000, rounds = 5) {
  for (let i = 0; i < 5000; i++) fn(i);              // let it tier up and warm any cache
  const rates = [];
  for (let r = 0; r < rounds; r++) {
    const t0 = process.hrtime.bigint();
    let sink = 0;
    for (let i = 0; i < iterations; i++) sink ^= fn(i);
    const ns = Number(process.hrtime.bigint() - t0);
    if (sink === 0x7fffffff) console.log('');        // keep the sink observable
    rates.push((iterations / ns) * 1e9);
  }
  rates.sort((a, b) => a - b);
  return rates[rates.length >> 1];
}

const ISO = scattered(1024, 61).map((ms) => new Date(Math.abs(ms) % 4.7e12).toISOString());
const MS = scattered(1024, 62).map((ms) => Math.abs(ms) % 4.7e12);
const CLUSTER = clustered(1024, 63);

describe('performance floors (≈20× headroom, not benchmarks)', () => {
  const floors = [
    ['parseISO', () => opsPerSec((i) => parseISO(ISO[i & 1023])), 1_000_000],
    ['toISO', () => opsPerSec((i) => toISO(MS[i & 1023]).length), 500_000],
    ['toISODate', () => opsPerSec((i) => toISODate(MS[i & 1023]).length), 500_000],
    ['addDays', () => opsPerSec((i) => addDays(MS[i & 1023], 7)), 5_000_000],
    ['addMonths', () => opsPerSec((i) => addMonths(MS[i & 1023], 1)), 1_000_000],
    ['startOfDay', () => opsPerSec((i) => startOfDay(MS[i & 1023])), 2_000_000],
    ['offsetAt (warm cache)', () => opsPerSec((i) => offsetAt('Europe/Bratislava', CLUSTER[i & 1023])), 1_000_000],
  ];
  for (const [name, run, floor] of floors) {
    test(`${name} exceeds ${(floor / 1e6).toFixed(1)}M ops/sec`, () => {
      const rate = run();
      assert.ok(rate > floor,
        `${name} managed ${(rate / 1e6).toFixed(2)}M ops/sec, below the ${(floor / 1e6).toFixed(1)}M floor — ` +
        'this is a 20x-headroom guard, so failing it means something structural changed');
    });
  }
});

describe('the zone cache is still a cache', () => {
  test('a clustered scan stays under one Intl call per 50 lookups', () => {
    resetZoneCaches();
    const tz = 'Europe/Bratislava';
    const N = 20_000;
    const t0 = Date.UTC(2024, 0, 1);
    for (let i = 0; i < N; i++) offsetAt(tz, t0 + i * 60_000);
    const { intlCalls } = zoneStats(tz);
    assert.ok(intlCalls < N / 50,
      `${intlCalls} Intl calls for ${N} lookups — the interval cache is not working`);
  });

  test('touching one day repeatedly costs a bounded number of Intl calls', () => {
    resetZoneCaches();
    const tz = 'America/New_York';
    const base = Date.UTC(2024, 5, 15);
    for (let i = 0; i < 10_000; i++) offsetAt(tz, base + (i % 86_400_000));
    const { intlCalls } = zoneStats(tz);
    assert.ok(intlCalls <= 8, `expected a handful of Intl calls for a single day, got ${intlCalls}`);
  });

  // A timing RATIO between two functions is deliberately NOT asserted here. opsPerSec
  // routes every candidate through one shared call site, which goes megamorphic as
  // distinct closures pass through it — measured at 5.7x for identical code — so an
  // in-process ratio is not trustworthy no matter how the threshold is set. Measured in
  // isolation the canonical parse path is ~1.26x the general one; that comparison belongs
  // in `npm run bench`, which gives every measurement its own process. What the unit suite
  // asserts instead is that both paths return the same answer (see parse.test.js).
});
