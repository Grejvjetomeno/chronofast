// Arithmetic and truncation. Month arithmetic is the part that goes wrong quietly:
// Jan 31 + 1 month has no obviously correct answer, and getting the clamp wrong produces a
// date in the following month rather than an error.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMilliseconds, addSeconds, addMinutes, addHours, addDays, addWeeks, addMonths, addYears,
  startOfMinute, startOfHour, startOfDay, startOfWeek, startOfMonth, startOfYear,
  diffDays, diffMonths, diffYears, toISO, toISODate, parseISO, compare, min, max,
} from '../lib/core.js';
import { ChronoInstant, ChronoPlain } from '../lib/index.js';
import { scattered, utc, MS_DAY, MS_HOUR, MS_MIN, MS_SEC } from './helpers.js';

const at = (s) => parseISO(s);
const d = (ms) => toISODate(ms);

describe('exact-time addition', () => {
  const base = utc(2024, 3, 15, 10, 30, 0, 0);
  test('addMilliseconds', () => assert.equal(addMilliseconds(base, 1500), base + 1500));
  test('addSeconds', () => assert.equal(addSeconds(base, 90), base + 90 * MS_SEC));
  test('addMinutes', () => assert.equal(addMinutes(base, 90), base + 90 * MS_MIN));
  test('addHours', () => assert.equal(addHours(base, 25), base + 25 * MS_HOUR));
  test('addDays', () => assert.equal(addDays(base, 7), base + 7 * MS_DAY));
  test('addWeeks', () => assert.equal(addWeeks(base, 2), base + 14 * MS_DAY));
  test('negative amounts', () => assert.equal(addDays(base, -7), base - 7 * MS_DAY));
  test('zero is identity', () => assert.equal(addDays(base, 0), base));
  test('addDays composes additively', () => {
    for (const ms of scattered(2000, 31)) {
      assert.equal(addDays(addDays(ms, 5), -5), ms);
      assert.equal(addDays(ms, 10), addDays(addDays(ms, 4), 6));
    }
  });
});

describe('addMonths — end-of-month clamping', () => {
  const cases = [
    ['Jan 31 + 1 = Feb 29 in a leap year', '2024-01-31T00:00:00.000Z', 1, '2024-02-29'],
    ['Jan 31 + 1 = Feb 28 in a common year', '2023-01-31T00:00:00.000Z', 1, '2023-02-28'],
    ['Jan 31 + 1 = Feb 28 in a ÷100 year', '1900-01-31T00:00:00.000Z', 1, '1900-02-28'],
    ['Jan 31 + 1 = Feb 29 in a ÷400 year', '2000-01-31T00:00:00.000Z', 1, '2000-02-29'],
    ['Jan 31 + 2 = Mar 31, no clamp needed', '2024-01-31T00:00:00.000Z', 2, '2024-03-31'],
    ['Mar 31 + 1 = Apr 30', '2024-03-31T00:00:00.000Z', 1, '2024-04-30'],
    ['May 31 + 1 = Jun 30', '2024-05-31T00:00:00.000Z', 1, '2024-06-30'],
    ['Aug 31 + 1 = Sep 30', '2024-08-31T00:00:00.000Z', 1, '2024-09-30'],
    ['Oct 31 + 1 = Nov 30', '2024-10-31T00:00:00.000Z', 1, '2024-11-30'],
    ['Dec 31 + 1 crosses the year', '2024-12-31T00:00:00.000Z', 1, '2025-01-31'],
    ['Jan 31 - 1 = Dec 31 previous year', '2024-01-31T00:00:00.000Z', -1, '2023-12-31'],
    ['Mar 31 - 1 = Feb 29', '2024-03-31T00:00:00.000Z', -1, '2024-02-29'],
    ['Feb 29 + 12 = Feb 28 next year', '2024-02-29T00:00:00.000Z', 12, '2025-02-28'],
    ['Feb 29 + 48 = Feb 29 four years on', '2024-02-29T00:00:00.000Z', 48, '2028-02-29'],
    ['+0 is identity', '2024-01-31T00:00:00.000Z', 0, '2024-01-31'],
    ['large positive', '2024-01-31T00:00:00.000Z', 25, '2026-02-28'],
    ['large negative', '2024-01-31T00:00:00.000Z', -25, '2021-12-31'],
  ];
  for (const [name, from, n, expected] of cases) {
    test(name, () => assert.equal(d(addMonths(at(from), n)), expected));
  }

  test('time of day is preserved by month arithmetic', () => {
    const t = at('2024-01-31T13:45:56.789Z');
    assert.equal(toISO(addMonths(t, 1)), '2024-02-29T13:45:56.789Z');
  });

  test('clamping never produces a date in the wrong month', () => {
    for (let m = 1; m <= 12; m++) {
      for (const day of [28, 29, 30, 31]) {
        for (const y of [2023, 2024, 1900, 2000]) {
          const src = Date.UTC(y, m - 1, day);
          if (new Date(src).getUTCDate() !== day) continue;   // skip dates that do not exist
          for (let n = -24; n <= 24; n++) {
            const got = addMonths(src, n);
            const total = (y * 12 + (m - 1)) + n;
            const wantY = Math.floor(total / 12);
            const wantM = total - wantY * 12;
            const g = new Date(got);
            assert.equal(g.getUTCFullYear(), wantY, `${y}-${m}-${day} + ${n}`);
            assert.equal(g.getUTCMonth(), wantM, `${y}-${m}-${day} + ${n}`);
            assert.ok(g.getUTCDate() <= day, `${y}-${m}-${day} + ${n} must not gain days`);
          }
        }
      }
    }
  });
});

describe('addYears', () => {
  test('is addMonths × 12', () => {
    for (const ms of scattered(1000, 32)) {
      for (const n of [-4, -1, 0, 1, 4]) assert.equal(addYears(ms, n), addMonths(ms, n * 12));
    }
  });
  test('Feb 29 + 1 year clamps to Feb 28', () => {
    assert.equal(d(addYears(at('2024-02-29T00:00:00.000Z'), 1)), '2025-02-28');
  });
});

describe('truncation', () => {
  const t = at('2024-03-15T13:45:56.789Z');
  test('startOfMinute', () => assert.equal(toISO(startOfMinute(t)), '2024-03-15T13:45:00.000Z'));
  test('startOfHour', () => assert.equal(toISO(startOfHour(t)), '2024-03-15T13:00:00.000Z'));
  test('startOfDay', () => assert.equal(toISO(startOfDay(t)), '2024-03-15T00:00:00.000Z'));
  test('startOfMonth', () => assert.equal(toISO(startOfMonth(t)), '2024-03-01T00:00:00.000Z'));
  test('startOfYear', () => assert.equal(toISO(startOfYear(t)), '2024-01-01T00:00:00.000Z'));
  test('startOfWeek defaults to Monday', () => assert.equal(toISO(startOfWeek(t)), '2024-03-11T00:00:00.000Z'));
  test('startOfWeek with Sunday', () => assert.equal(toISO(startOfWeek(t, 0)), '2024-03-10T00:00:00.000Z'));

  test('truncation is idempotent', () => {
    for (const ms of scattered(2000, 33)) {
      for (const f of [startOfMinute, startOfHour, startOfDay, startOfMonth, startOfYear]) {
        assert.equal(f(f(ms)), f(ms));
      }
    }
  });

  test('truncation never moves forward in time', () => {
    for (const ms of scattered(2000, 34)) {
      for (const f of [startOfMinute, startOfHour, startOfDay, startOfMonth, startOfYear, startOfWeek]) {
        assert.ok(f(ms) <= ms, `${f.name} moved forward at ${toISO(ms)}`);
      }
    }
  });

  test('startOfDay agrees with Date for negative epochs too', () => {
    for (const ms of scattered(3000, 35)) {
      const dd = new Date(ms);
      assert.equal(startOfDay(ms), Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()));
    }
  });
});

describe('differences', () => {
  test('diffDays counts calendar days, not 24-hour spans', () => {
    assert.equal(diffDays(at('2024-03-15T23:59:00.000Z'), at('2024-03-16T00:01:00.000Z')), 1);
    assert.equal(diffDays(at('2024-03-15T00:00:00.000Z'), at('2024-03-15T23:59:00.000Z')), 0);
  });
  test('diffDays is signed', () => {
    assert.equal(diffDays(at('2024-03-16T00:00:00.000Z'), at('2024-03-15T00:00:00.000Z')), -1);
  });
  test('diffDays across a year boundary', () => {
    assert.equal(diffDays(at('2023-12-31T00:00:00.000Z'), at('2024-01-01T00:00:00.000Z')), 1);
  });
  test('diffDays over a leap year is 366', () => {
    assert.equal(diffDays(at('2024-01-01T00:00:00.000Z'), at('2025-01-01T00:00:00.000Z')), 366);
  });
  test('diffDays over a common year is 365', () => {
    assert.equal(diffDays(at('2023-01-01T00:00:00.000Z'), at('2024-01-01T00:00:00.000Z')), 365);
  });
  test('diffMonths truncates toward zero', () => {
    assert.equal(diffMonths(at('2024-01-31T00:00:00.000Z'), at('2024-02-29T00:00:00.000Z')), 0);
    assert.equal(diffMonths(at('2024-01-15T00:00:00.000Z'), at('2024-02-15T00:00:00.000Z')), 1);
    assert.equal(diffMonths(at('2024-01-15T00:00:00.000Z'), at('2024-02-14T00:00:00.000Z')), 0);
    assert.equal(diffMonths(at('2024-02-15T00:00:00.000Z'), at('2024-01-15T00:00:00.000Z')), -1);
  });
  test('diffYears', () => {
    assert.equal(diffYears(at('2020-06-15T00:00:00.000Z'), at('2024-06-15T00:00:00.000Z')), 4);
    assert.equal(diffYears(at('2020-06-15T00:00:00.000Z'), at('2024-06-14T00:00:00.000Z')), 3);
  });
  test('diffDays is antisymmetric', () => {
    const xs = scattered(1000, 36);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      assert.equal(diffDays(xs[i], xs[i + 1]), -diffDays(xs[i + 1], xs[i]));
    }
  });
});

describe('comparison helpers', () => {
  const a = at('2024-01-01T00:00:00.000Z'), b = at('2024-06-01T00:00:00.000Z');
  test('compare', () => {
    assert.equal(compare(a, b), -1);
    assert.equal(compare(b, a), 1);
    assert.equal(compare(a, a), 0);
  });
  test('min / max', () => {
    assert.equal(min(a, b), a);
    assert.equal(max(a, b), b);
  });
  test('sorting with compare orders ascending', () => {
    const xs = scattered(500, 37).slice();
    const sorted = xs.slice().sort(compare);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1] <= sorted[i]);
  });
});

describe('the classes are immutable and chainable', () => {
  test('ChronoInstant exact-time methods return new instances and never mutate', () => {
    const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
    const before = t.ms;
    for (const op of ['addMilliseconds', 'addSeconds', 'addMinutes', 'addHours', 'addDays']) {
      const r = t[op](3);
      assert.notEqual(r, t, `${op} returned the same object`);
      assert.equal(t.ms, before, `${op} mutated the receiver`);
      assert.ok(r instanceof ChronoInstant);
    }
  });

  test('ChronoPlain calendar methods return new instances and never mutate', () => {
    const p = ChronoPlain.parse('2024-03-15T10:30:00.000');
    const before = p.wall;
    for (const op of ['addMilliseconds', 'addSeconds', 'addMinutes', 'addHours', 'addDays',
                      'addWeeks', 'addMonths', 'addYears']) {
      const r = p[op](3);
      assert.notEqual(r, p, `${op} returned the same object`);
      assert.equal(p.wall, before, `${op} mutated the receiver`);
      assert.ok(r instanceof ChronoPlain);
    }
    for (const op of ['startOfMinute', 'startOfHour', 'startOfDay', 'startOfWeek', 'startOfMonth', 'startOfYear']) {
      const r = p[op]();
      assert.notEqual(r, p, `${op} returned the same object`);
      assert.equal(p.wall, before, `${op} mutated the receiver`);
    }
  });

  test('chains compose', () => {
    const r = ChronoPlain.parse('2024-01-31T10:30:00.000').addMonths(1).addDays(1).startOfDay();
    assert.equal(r.toPlainISOString(), '2024-03-01T00:00:00');
  });

  test('daysUntil and monthsUntil', () => {
    const a2 = ChronoPlain.parse('2024-01-01T00:00:00.000');
    const b2 = ChronoPlain.parse('2024-03-15T00:00:00.000');
    assert.equal(a2.daysUntil(b2), 74);
    assert.equal(a2.monthsUntil(b2), 2);
  });

  test('equals / isBefore / isAfter on moments', () => {
    const a2 = ChronoInstant.parse('2024-01-01T00:00:00.000Z');
    const b2 = ChronoInstant.parse('2024-03-15T00:00:00.000Z');
    assert.ok(a2.isBefore(b2));
    assert.ok(b2.isAfter(a2));
    assert.ok(a2.equals(ChronoInstant.parse('2024-01-01T00:00:00.000Z')));
    assert.equal(a2.equals(b2), false);
  });

  test('static compare sorts instances', () => {
    const xs = [10, 3, 7, 1].map((n) => ChronoInstant.fromEpochMs(n * 86_400_000));
    xs.sort(ChronoInstant.compare);
    assert.deepEqual(xs.map((x) => x.ms / 86_400_000), [1, 3, 7, 10]);
  });
});
