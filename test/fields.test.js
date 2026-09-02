// Field access. chronofast returns multi-value results through module-scoped scratch slots
// that are ES module LIVE BINDINGS — a real bug once shipped in this repo's own benchmark
// harness by copying them with object spread, which snapshots them at zero. The last suite
// here exists specifically to catch that class of mistake.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getYear, getMonth, getDay, getHour, getMinute, getSecond, getMillisecond,
  dayOfWeek, dayOfWeekSunday0, isoWeek, isoWeekYear, dayOfYear, daysInMonth, isLeapYear,
  unpack, readFields, parseISO, cY, cM, cD, cH, cMi, cS, cMs,
} from '../lib/core.js';
import { ChronoPlain } from '../lib/index.js';
import { scattered, EDGE_INSTANTS } from './helpers.js';

const at = (s) => parseISO(s);

describe('field getters agree with Date', () => {
  test('across 20000 scattered instants', () => {
    for (const ms of scattered(20000, 41)) {
      const d = new Date(ms);
      assert.equal(getYear(ms), d.getUTCFullYear(), `year at ${d.toISOString()}`);
      assert.equal(getMonth(ms), d.getUTCMonth() + 1, `month at ${d.toISOString()}`);
      assert.equal(getDay(ms), d.getUTCDate(), `day at ${d.toISOString()}`);
      assert.equal(getHour(ms), d.getUTCHours(), `hour at ${d.toISOString()}`);
      assert.equal(getMinute(ms), d.getUTCMinutes(), `minute at ${d.toISOString()}`);
      assert.equal(getSecond(ms), d.getUTCSeconds(), `second at ${d.toISOString()}`);
      assert.equal(getMillisecond(ms), d.getUTCMilliseconds(), `ms at ${d.toISOString()}`);
      assert.equal(dayOfWeekSunday0(ms), d.getUTCDay(), `dow at ${d.toISOString()}`);
    }
  });

  test('across the edge set', () => {
    for (const [name, ms] of EDGE_INSTANTS) {
      const d = new Date(ms);
      assert.equal(getYear(ms), d.getUTCFullYear(), name);
      assert.equal(getMonth(ms), d.getUTCMonth() + 1, name);
      assert.equal(getDay(ms), d.getUTCDate(), name);
      assert.equal(getHour(ms), d.getUTCHours(), name);
    }
  });

  test('negative epochs (time-of-day must not go negative)', () => {
    for (let i = 1; i <= 5000; i++) {
      const ms = -i * 97_003;
      const d = new Date(ms);
      assert.equal(getHour(ms), d.getUTCHours(), `hour at ${d.toISOString()}`);
      assert.equal(getMinute(ms), d.getUTCMinutes(), `minute at ${d.toISOString()}`);
      assert.equal(getSecond(ms), d.getUTCSeconds(), `second at ${d.toISOString()}`);
      assert.equal(getMillisecond(ms), d.getUTCMilliseconds(), `ms at ${d.toISOString()}`);
    }
  });
});

describe('no function returns -0', () => {
  // -0 compares equal to 0 but is distinguishable via Object.is, survives into some
  // serialisers, and is a classic source of "why does this key not match" bugs.
  test('dayOfWeek and getMillisecond normalise negative zero', () => {
    for (let i = 0; i < 20000; i++) {
      const ms = -i * 1000;                      // exact second boundaries, negative side
      assert.ok(!Object.is(dayOfWeekSunday0(ms), -0), `dayOfWeekSunday0 returned -0 at ${ms}`);
      assert.ok(!Object.is(getMillisecond(ms), -0), `getMillisecond returned -0 at ${ms}`);
      assert.ok(!Object.is(getHour(ms), -0), `getHour returned -0 at ${ms}`);
      assert.ok(!Object.is(getMinute(ms), -0), `getMinute returned -0 at ${ms}`);
      assert.ok(!Object.is(getSecond(ms), -0), `getSecond returned -0 at ${ms}`);
    }
  });
});

describe('day of week', () => {
  const known = [
    ['1970-01-01T00:00:00.000Z', 4, 4],   // Thursday
    ['2024-03-15T00:00:00.000Z', 5, 5],   // Friday
    ['2024-03-17T00:00:00.000Z', 0, 7],   // Sunday: 0 for Date-style, 7 for ISO
    ['2024-03-18T00:00:00.000Z', 1, 1],   // Monday
    ['2000-01-01T00:00:00.000Z', 6, 6],   // Saturday
  ];
  for (const [s, dowExpected, isoExpected] of known) {
    test(s, () => {
      assert.equal(dayOfWeekSunday0(at(s)), dowExpected, 'dayOfWeekSunday0 (0 = Sunday)');
      assert.equal(dayOfWeek(at(s)), isoExpected, 'dayOfWeek (ISO, 1 = Monday)');
    });
  }
  test('dayOfWeek is ISO 1..7 and consistent with the Sunday-first variant', () => {
    for (const ms of scattered(5000, 42)) {
      const i = dayOfWeek(ms);
      assert.ok(i >= 1 && i <= 7, `out of range: ${i}`);
      assert.equal(i, ((dayOfWeekSunday0(ms) + 6) % 7) + 1);
    }
  });

  test('the two names cannot be confused: they disagree on Sunday', () => {
    const sunday = at('2024-03-17T00:00:00.000Z');
    assert.equal(dayOfWeek(sunday), 7, 'ISO Sunday is 7');
    assert.equal(dayOfWeekSunday0(sunday), 0, 'Date-style Sunday is 0');
  });
});

describe('ISO week numbering', () => {
  // Hand-checked against the ISO-8601 definition: week 1 contains the first Thursday.
  const known = [
    ['2024-01-01T00:00:00.000Z', 1, 2024],
    ['2023-01-01T00:00:00.000Z', 52, 2022],   // a Sunday, belongs to 2022-W52
    ['2021-01-04T00:00:00.000Z', 1, 2021],
    ['2020-12-31T00:00:00.000Z', 53, 2020],   // 2020 has 53 ISO weeks
    ['2019-12-30T00:00:00.000Z', 1, 2020],    // belongs to the next ISO year
    ['2026-09-01T00:00:00.000Z', 36, 2026],
    ['2015-12-28T00:00:00.000Z', 53, 2015],
    ['2016-01-03T00:00:00.000Z', 53, 2015],
  ];
  for (const [s, week, weekYear] of known) {
    test(`${s} is ${weekYear}-W${week}`, () => {
      assert.equal(isoWeek(at(s)), week);
      assert.equal(isoWeekYear(at(s)), weekYear);
    });
  }
  test('week is always 1..53', () => {
    for (const ms of scattered(10000, 43)) {
      const w = isoWeek(ms);
      assert.ok(w >= 1 && w <= 53, `week ${w} at ${new Date(ms).toISOString()}`);
    }
  });
  test('the week number is constant across a whole ISO week', () => {
    let t = at('2024-03-11T00:00:00.000Z');   // a Monday
    const w = isoWeek(t);
    for (let i = 0; i < 7; i++) {
      assert.equal(isoWeek(t + i * 86_400_000), w, `day ${i}`);
    }
    assert.notEqual(isoWeek(t + 7 * 86_400_000), w);
  });
});

describe('day of year', () => {
  test('1 January is day 1', () => assert.equal(dayOfYear(at('2024-01-01T00:00:00.000Z')), 1));
  test('31 December of a leap year is day 366', () => assert.equal(dayOfYear(at('2024-12-31T00:00:00.000Z')), 366));
  test('31 December of a common year is day 365', () => assert.equal(dayOfYear(at('2023-12-31T00:00:00.000Z')), 365));
  test('1 March of a leap year is day 61', () => assert.equal(dayOfYear(at('2024-03-01T00:00:00.000Z')), 61));
  test('1 March of a common year is day 60', () => assert.equal(dayOfYear(at('2023-03-01T00:00:00.000Z')), 60));
});

describe('calendar helpers', () => {
  test('daysInMonth', () => {
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2023, 2), 28);
    assert.equal(daysInMonth(1900, 2), 28);
    assert.equal(daysInMonth(2000, 2), 29);
    for (const [m, n] of [[1, 31], [3, 31], [4, 30], [5, 31], [6, 30], [7, 31],
                          [8, 31], [9, 30], [10, 31], [11, 30], [12, 31]]) {
      assert.equal(daysInMonth(2024, m), n, `month ${m}`);
    }
  });
  test('isLeapYear', () => {
    for (const y of [2024, 2020, 2000, 1996, 1600]) assert.equal(isLeapYear(y), true, String(y));
    for (const y of [2023, 2100, 1900, 1800, 2001]) assert.equal(isLeapYear(y), false, String(y));
  });
  test('daysInMonth agrees with Date for every month 1900-2100', () => {
    for (let y = 1900; y <= 2100; y++) {
      for (let m = 1; m <= 12; m++) {
        assert.equal(daysInMonth(y, m), new Date(Date.UTC(y, m, 0)).getUTCDate(), `${y}-${m}`);
      }
    }
  });
});

describe('unpack and the live-binding scratch slots', () => {
  test('unpack fills every slot', () => {
    unpack(at('2024-03-15T13:45:56.789Z'));
    assert.deepEqual([cY, cM, cD, cH, cMi, cS, cMs], [2024, 3, 15, 13, 45, 56, 789]);
  });

  test('the slots are LIVE bindings, not a snapshot', () => {
    // Reading through the module namespace must observe each new write. Copying them into
    // a plain object with spread would freeze them here - that is the regression guarded.
    const seen = [];
    for (const s of ['2024-03-15T00:00:00.000Z', '1998-11-03T12:00:00.000Z', '2031-07-15T23:00:00.000Z']) {
      unpack(at(s));
      seen.push([cY, cM, cD]);
    }
    assert.deepEqual(seen, [[2024, 3, 15], [1998, 11, 3], [2031, 7, 15]]);
    assert.notEqual(seen[0][0], seen[1][0], 'slots never changed - they are not live');
  });

  test('readFields snapshots the current slots', () => {
    unpack(at('2024-03-15T13:45:56.789Z'));
    const a = readFields();
    unpack(at('1998-11-03T01:02:03.004Z'));
    const b = readFields();
    assert.deepEqual(a, { year: 2024, month: 3, day: 15, hour: 13, minute: 45, second: 56, millisecond: 789 });
    assert.deepEqual(b, { year: 1998, month: 11, day: 3, hour: 1, minute: 2, second: 3, millisecond: 4 });
    assert.notEqual(a, b);
  });

  test('unpack agrees with Date over 10000 instants', () => {
    for (const ms of scattered(10000, 44)) {
      unpack(ms);
      const d = new Date(ms);
      assert.equal(cY, d.getUTCFullYear());
      assert.equal(cM, d.getUTCMonth() + 1);
      assert.equal(cD, d.getUTCDate());
      assert.equal(cH, d.getUTCHours());
      assert.equal(cMi, d.getUTCMinutes());
      assert.equal(cS, d.getUTCSeconds());
      assert.equal(cMs, d.getUTCMilliseconds());
    }
  });
});

// Calendar fields live on ChronoPlain now: a moment has none, by design.
describe('ChronoPlain field accessors', () => {
  const t = ChronoPlain.parse('2024-03-15T13:45:56.789');
  test('individual getters', () => {
    assert.equal(t.year, 2024);
    assert.equal(t.month, 3);
    assert.equal(t.day, 15);
    assert.equal(t.hour, 13);
    assert.equal(t.minute, 45);
    assert.equal(t.second, 56);
    assert.equal(t.millisecond, 789);
  });
  test('derived getters', () => {
    assert.equal(t.dayOfWeek, 5);
    assert.equal(t.dayOfYear, 75);
    assert.equal(t.weekOfYear, 11);
    assert.equal(t.weekYear, 2024);
  });
  test('fields() matches the individual getters', () => {
    assert.deepEqual(t.fields(), {
      year: t.year, month: t.month, day: t.day,
      hour: t.hour, minute: t.minute, second: t.second, millisecond: t.millisecond,
    });
  });
  test('getters are stable when instances are interleaved', () => {
    const a = ChronoPlain.parse('2024-03-15T00:00:00.000');
    const b = ChronoPlain.parse('1998-11-03T00:00:00.000');
    for (let i = 0; i < 500; i++) {
      assert.equal(a.year, 2024);
      assert.equal(b.year, 1998);
      assert.equal(a.day, 15);
      assert.equal(b.day, 3);
    }
  });
});
