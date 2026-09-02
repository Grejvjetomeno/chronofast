// Formatting. The emitters build their whole result with one String.fromCharCode call, so
// an off-by-one in any digit position produces a subtly wrong string rather than a crash.
// These tests pin exact output rather than merely checking it parses back.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toISO, toISODate, parseISO } from '../lib/core.js';
import { ChronoInstant, ChronoPlain } from '../lib/index.js';
import { EDGE_INSTANTS, scattered, clustered, utc } from './helpers.js';

describe('toISO — exact output', () => {
  const cases = [
    ['epoch', 0, '1970-01-01T00:00:00.000Z'],
    ['one ms before epoch', -1, '1969-12-31T23:59:59.999Z'],
    ['leap day', utc(2024, 2, 29, 12, 0, 0, 0), '2024-02-29T12:00:00.000Z'],
    ['single-digit everything', utc(2024, 1, 2, 3, 4, 5, 6), '2024-01-02T03:04:05.006Z'],
    ['double-digit everything', utc(2024, 11, 22, 13, 44, 55, 666), '2024-11-22T13:44:55.666Z'],
    ['end of year', utc(2024, 12, 31, 23, 59, 59, 999), '2024-12-31T23:59:59.999Z'],
    ['ms 1', utc(2024, 6, 1, 0, 0, 0, 1), '2024-06-01T00:00:00.001Z'],
    ['ms 10', utc(2024, 6, 1, 0, 0, 0, 10), '2024-06-01T00:00:00.010Z'],
    ['ms 100', utc(2024, 6, 1, 0, 0, 0, 100), '2024-06-01T00:00:00.100Z'],
    ['year 1', utc(1, 1, 1), '0001-01-01T00:00:00.000Z'],
    ['year 999', utc(999, 12, 31), '0999-12-31T00:00:00.000Z'],
    ['year 1000', utc(1000, 1, 1), '1000-01-01T00:00:00.000Z'],
  ];
  for (const [name, ms, expected] of cases) {
    test(name, () => assert.equal(toISO(ms), expected));
  }

  test('matches Date.prototype.toISOString byte for byte, 20000 instants', () => {
    for (const ms of scattered(20000, 21)) {
      assert.equal(toISO(ms), new Date(ms).toISOString());
    }
  });

  test('expanded years outside 0000-9999 use the ± form', () => {
    for (const ms of [Date.UTC(10000, 0, 1), Date.UTC(-1, 0, 1), Date.UTC(275760, 8, 13) - MS_DAY_SAFE()]) {
      if (!Number.isFinite(ms)) continue;
      assert.equal(toISO(ms), new Date(ms).toISOString(), String(ms));
    }
    function MS_DAY_SAFE() { return 86_400_000; }
  });

  test('every day of a leap year formats correctly', () => {
    let t = utc(2024, 1, 1);
    for (let i = 0; i < 366; i++) {
      assert.equal(toISO(t), new Date(t).toISOString());
      t += 86_400_000;
    }
  });

  test('every hour of a day', () => {
    for (let h = 0; h < 24; h++) {
      const t = utc(2024, 3, 15, h, 30, 45, 123);
      assert.equal(toISO(t), new Date(t).toISOString());
    }
  });
});

describe('toISODate — exact output', () => {
  const cases = [
    [0, '1970-01-01'],
    [-1, '1969-12-31'],
    [utc(2024, 2, 29, 23, 59, 59, 999), '2024-02-29'],
    [utc(2024, 12, 31, 0, 0, 0, 0), '2024-12-31'],
    [utc(1, 1, 1), '0001-01-01'],
  ];
  for (const [ms, expected] of cases) {
    test(expected, () => assert.equal(toISODate(ms), expected));
  }

  test('equals the first ten characters of toISO, 10000 instants', () => {
    for (const ms of scattered(10000, 22)) {
      assert.equal(toISODate(ms), toISO(ms).slice(0, 10));
    }
  });

  // toISODate memoises on the day index. Interleaving days must not return a stale string.
  test('memo does not leak between interleaved days', () => {
    const days = [utc(2024, 3, 15), utc(1998, 11, 3), utc(2031, 7, 15), utc(1970, 1, 1)];
    const want = days.map((d) => new Date(d).toISOString().slice(0, 10));
    for (let i = 0; i < 3000; i++) {
      const k = i % days.length;
      assert.equal(toISODate(days[k] + (i % 86_400_000)), want[k]);
    }
  });

  test('memo is correct across a clustered run, which is where it actually hits', () => {
    for (const ms of clustered(5000, 23)) {
      assert.equal(toISODate(ms), new Date(ms).toISOString().slice(0, 10));
    }
  });
});

describe('format/parse round trip', () => {
  test('parse(toISO(x)) === x over the edge set', () => {
    for (const [name, ms] of EDGE_INSTANTS) {
      assert.equal(parseISO(toISO(ms)), ms, name);
    }
  });

  test('parse(toISO(x)) === x over 20000 scattered instants', () => {
    for (const ms of scattered(20000, 24)) {
      assert.equal(parseISO(toISO(ms)), ms);
    }
  });
});

describe('ChronoInstant output methods', () => {
  const t = ChronoInstant.parse('2024-03-15T10:30:00.123Z');
  const p = ChronoPlain.parse('2024-03-15T10:30:00.123');
  test('toISOString', () => assert.equal(t.toISOString(), '2024-03-15T10:30:00.123Z'));
  test('toISODate', () => assert.equal(t.toISODate(), '2024-03-15'));
  test('toString equals toISOString', () => assert.equal(t.toString(), t.toISOString()));
  test('toJSON equals toISOString', () => assert.equal(t.toJSON(), t.toISOString()));
  test('JSON.stringify uses toJSON', () => assert.equal(JSON.stringify({ t }), '{"t":"2024-03-15T10:30:00.123Z"}'));
  test('valueOf is the epoch ms', () => assert.equal(t.valueOf(), utc(2024, 3, 15, 10, 30, 0, 123)));
  test('epochMilliseconds', () => assert.equal(t.epochMilliseconds, t.valueOf()));
  test('toDate returns an equivalent Date', () => assert.equal(t.toDate().getTime(), t.ms));
  test('arithmetic comparison works through valueOf', () => {
    const later = ChronoInstant.parse('2024-03-16T10:30:00.123Z');
    assert.ok(later > t);
    assert.equal(later - t, 86_400_000);
  });
});
