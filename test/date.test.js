// ChronoDate - the calendar-date type.
//
// Two things are being pinned here. First, parity with Temporal.PlainDate, because that is
// what callers are migrating from and a silent difference is worse than a missing feature.
// Second, the absence of time: a date that grows an `hour` getter has stopped being a date,
// and the whole reason this type exists rather than "a ChronoPlain at midnight" is that the
// type system can refuse the question.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Temporal } from 'temporal-polyfill';
import {
  ChronoDate, ChronoPlain, ChronoZoned, ChronoInstant, InvalidInstantError,
} from '../lib/index.js';

const TZ = 'Europe/Bratislava';

describe('ChronoDate matches Temporal.PlainDate', () => {
  // A spread of dates: leap days, month ends, year boundaries, pre-epoch, far future.
  const DATES = [
    '2024-03-15', '2024-01-01', '2024-12-31', '2024-02-29', '2023-02-28',
    '2000-02-29', '1900-03-01', '1970-01-01', '1969-12-31', '1900-01-01',
    '2100-02-28', '2024-01-31', '2024-04-30', '0001-01-01', '9999-12-31',
  ];

  for (const s of DATES) {
    test(s, () => {
      const c = ChronoDate.parse(s);
      const t = Temporal.PlainDate.from(s);
      assert.equal(c.toISODate(), t.toString(), 'toString');
      assert.equal(c.year, t.year, 'year');
      assert.equal(c.month, t.month, 'month');
      assert.equal(c.day, t.day, 'day');
      assert.equal(c.dayOfWeek, t.dayOfWeek, 'dayOfWeek');
      assert.equal(c.dayOfYear, t.dayOfYear, 'dayOfYear');
      assert.equal(c.weekOfYear, t.weekOfYear, 'weekOfYear');
      assert.equal(c.daysInMonth, t.daysInMonth, 'daysInMonth');
      assert.equal(c.daysInYear, t.daysInYear, 'daysInYear');
      assert.equal(c.inLeapYear, t.inLeapYear, 'inLeapYear');
    });
  }

  test('arithmetic agrees across a wide range of offsets', () => {
    for (const s of DATES) {
      const c = ChronoDate.parse(s);
      const t = Temporal.PlainDate.from(s);
      for (const n of [-400, -31, -1, 0, 1, 7, 31, 365, 4000]) {
        assert.equal(c.addDays(n).toISODate(), t.add({ days: n }).toString(), `${s} +${n}d`);
      }
      for (const n of [-25, -13, -1, 0, 1, 13, 25, 240]) {
        assert.equal(c.addMonths(n).toISODate(), t.add({ months: n }).toString(), `${s} +${n}mo`);
        assert.equal(c.addYears(n).toISODate(), t.add({ years: n }).toString(), `${s} +${n}y`);
      }
    }
  });

  test('end-of-month clamping matches, which is where libraries usually differ', () => {
    const cases = [
      ['2024-01-31', 1, '2024-02-29'], ['2023-01-31', 1, '2023-02-28'],
      ['2024-03-31', -1, '2024-02-29'], ['2024-05-31', 1, '2024-06-30'],
      ['2024-02-29', 12, '2025-02-28'], ['2024-08-31', 6, '2025-02-28'],
    ];
    for (const [from, n, want] of cases) {
      assert.equal(ChronoDate.parse(from).addMonths(n).toISODate(), want);
      assert.equal(Temporal.PlainDate.from(from).add({ months: n }).toString(), want,
        'Temporal must agree, or the expectation itself is wrong');
    }
  });

  test('parse accepts exactly what Temporal accepts', () => {
    const forms = [
      '2024-03-15', '2024-03-15T10:30', '2024-03-15T10:30:00',
      '2024-03-15T10:30:00Z', '2024-03-15T10:30:00z',
      '2024-03-15T10:30:00+01:00', '2024-03-15T23:30:00-05:00',
    ];
    for (const s of forms) {
      const t = (() => { try { return Temporal.PlainDate.from(s).toString(); } catch { return 'THROWS'; } })();
      const c = (() => { try { return ChronoDate.parse(s).toISODate(); } catch { return 'THROWS'; } })();
      assert.equal(c, t, `disagreed on ${s}`);
    }
  });
});

describe('a date cannot carry a time', () => {
  const d = ChronoDate.parse('2024-03-15');

  for (const f of ['hour', 'minute', 'second', 'millisecond',
                   'addHours', 'addMinutes', 'addSeconds', 'addMilliseconds',
                   'startOfDay', 'startOfHour', 'startOfMinute',
                   'epochMilliseconds', 'toDate', 'inZone', 'toISOString']) {
    test(`has no ${f}`, () => assert.equal(f in d, false));
  }

  test('Temporal.PlainDate agrees about the ones it also lacks', () => {
    const t = Temporal.PlainDate.from('2024-03-15');
    for (const f of ['hour', 'minute', 'second', 'epochMilliseconds']) {
      assert.equal(f in t, false, f);
    }
  });

  test('the way to a time is explicit, and lands in the right type', () => {
    assert.ok(d.toPlain() instanceof ChronoPlain);
    assert.equal(d.toPlain().toPlainISOString(), '2024-03-15T00:00:00');
    assert.equal(d.toPlain().hour, 0, 'the time is zero, and now visibly so');
    assert.equal(d.atTime(14, 30).toPlainISOString(), '2024-03-15T14:30:00');
    assert.equal(d.atTime(14, 30, 15, 250).toPlainISOString(), '2024-03-15T14:30:15.25');
    assert.ok(d.atStartOfDay(TZ) instanceof ChronoZoned);
  });

  test('atStartOfDay is DST-correct, unlike pinning a wall clock to midnight', () => {
    // Bratislava springs forward at 02:00, so midnight exists on 31 March 2024.
    assert.equal(ChronoDate.parse('2024-03-31').atStartOfDay(TZ).toISOString(),
                 '2024-03-31T00:00:00.000+01:00');
    // America/Santiago changes at midnight itself, so this one really has no 00:00.
    const santiago = ChronoDate.parse('2024-09-08').atStartOfDay('America/Santiago');
    assert.equal(santiago.hour, 1, 'midnight does not exist; start of day is 01:00');
  });
});

describe('day-index arithmetic is exact', () => {
  test('daysUntil over 60k days round-trips through addDays', () => {
    const base = ChronoDate.parse('2000-01-01');
    for (let n = -30000; n < 30000; n += 7) {
      const other = base.addDays(n);
      assert.equal(base.daysUntil(other), n);
      assert.equal(other.daysUntil(base), -n);
    }
  });

  test('subtraction through valueOf gives whole days', () => {
    const a = ChronoDate.parse('2024-03-15');
    const b = ChronoDate.parse('2024-03-22');
    assert.equal(b - a, 7);
    assert.ok(a < b);
    assert.ok(b > a);
    assert.ok(a <= a);
  });

  test('monthsUntil and yearsUntil truncate toward zero', () => {
    const a = ChronoDate.parse('2024-01-31');
    assert.equal(a.monthsUntil(ChronoDate.parse('2024-04-30')), 2, 'not yet a full third month');
    assert.equal(a.monthsUntil(ChronoDate.parse('2024-05-31')), 4);
    assert.equal(ChronoDate.parse('2024-03-15').yearsUntil(ChronoDate.parse('2027-03-14')), 2);
    assert.equal(ChronoDate.parse('2027-03-15').yearsUntil(ChronoDate.parse('2024-03-15')), -3);
  });

  test('week and month truncation', () => {
    const d = ChronoDate.parse('2024-03-15');       // a Friday
    assert.equal(d.startOfWeek().toISODate(), '2024-03-11', 'Monday');
    assert.equal(d.startOfWeek(7).toISODate(), '2024-03-10', 'Sunday');
    assert.equal(d.startOfMonth().toISODate(), '2024-03-01');
    assert.equal(d.endOfMonth().toISODate(), '2024-03-31');
    assert.equal(d.startOfYear().toISODate(), '2024-01-01');
    assert.equal(ChronoDate.parse('2024-02-10').endOfMonth().toISODate(), '2024-02-29');
    assert.equal(ChronoDate.parse('2023-02-10').endOfMonth().toISODate(), '2023-02-28');
  });

  test('sorting uses the day index directly', () => {
    const xs = ['2024-06-01', '2024-01-01', '2024-12-01', '2024-03-01'].map((s) => ChronoDate.parse(s));
    xs.sort(ChronoDate.compare);
    assert.deepEqual(xs.map((x) => x.toISODate()),
                     ['2024-01-01', '2024-03-01', '2024-06-01', '2024-12-01']);
  });
});

describe('conversions between the four types', () => {
  test('ChronoPlain drops its time to become a date', () => {
    assert.equal(ChronoPlain.parse('2024-03-15T23:59:59.999').toPlainDate().toISODate(), '2024-03-15');
  });

  test('ChronoZoned yields the LOCAL date, which is the whole point', () => {
    const z = ChronoInstant.parse('2024-03-15T23:30:00Z').inZone(TZ);
    assert.equal(z.toPlainDate().toISODate(), '2024-03-16', 'local date, not the UTC one');
    assert.equal(ChronoInstant.parse('2024-03-15T23:30:00Z').toUtcPlain().toPlainDate().toISODate(),
                 '2024-03-15', 'and the UTC reading still gives the UTC date');
  });

  test('date -> zoned -> date round-trips in every zone tried', () => {
    for (const tz of ['UTC', 'Europe/Bratislava', 'America/New_York', 'Asia/Kolkata',
                      'Pacific/Chatham', 'Australia/Lord_Howe', 'Pacific/Kiritimati']) {
      for (const s of ['2024-03-15', '2024-03-31', '2024-10-27', '2024-01-01', '2024-12-31']) {
        const d = ChronoDate.parse(s);
        assert.equal(d.atStartOfDay(tz).toPlainDate().toISODate(), s, `${s} in ${tz}`);
      }
    }
  });

  test('of() and the getters are inverses over 40k dates', () => {
    for (let i = -20000; i < 20000; i++) {
      const d = new ChronoDate(i);
      assert.equal(ChronoDate.of(d.year, d.month, d.day).dayIndex, i);
    }
  });
});

describe('ChronoDate follows the same failure contract as the rest', () => {
  test('parse throws, tryParse returns null', () => {
    for (const bad of ['not-a-date', '', '2024-02-30', '2024-13-01', '15/03/2024']) {
      assert.throws(() => ChronoDate.parse(bad), InvalidInstantError, bad);
      assert.throws(() => ChronoDate.parse(bad), RangeError, bad);
      assert.equal(ChronoDate.tryParse(bad), null, bad);
    }
  });

  test('a trailing Z is refused, because the date depends on a zone it does not name', () => {
    assert.throws(() => ChronoDate.parse('2024-03-15T23:30:00Z'), RangeError);
    assert.equal(ChronoDate.tryParse('2024-03-15T23:30:00Z'), null);
    assert.throws(() => Temporal.PlainDate.from('2024-03-15T23:30:00Z'), RangeError,
      'Temporal refuses it too, which is why we do');
  });

  test('an explicit offset IS accepted, matching Temporal', () => {
    assert.equal(ChronoDate.parse('2024-03-15T23:30:00+01:00').toISODate(), '2024-03-15');
  });

  test('an invalid date serialises safely, never to a NUL-bearing string', () => {
    const bad = new ChronoDate(NaN);
    assert.equal(bad.isValid, false);
    assert.equal(bad.toString(), 'Invalid Date');
    assert.equal(bad.toJSON(), null);
    assert.equal(JSON.stringify({ d: bad }), '{"d":null}');
    assert.throws(() => bad.toISODate(), RangeError);
  });

  test('JSON round-trips through parse', () => {
    const d = ChronoDate.parse('2024-03-15');
    assert.equal(JSON.stringify({ d }), '{"d":"2024-03-15"}');
    assert.equal(ChronoDate.parse(JSON.parse(JSON.stringify({ d })).d).dayIndex, d.dayIndex);
  });

  test('now() reads the local calendar date', () => {
    const today = new Date().toLocaleDateString('sv-SE');
    assert.equal(ChronoDate.now().toISODate(), today);
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Midway']) {
      assert.equal(ChronoDate.now(tz).toISODate(),
                   new Date().toLocaleDateString('sv-SE', { timeZone: tz }), tz);
    }
  });
});
