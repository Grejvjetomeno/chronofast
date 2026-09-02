// `Now` and the plain-string serialiser.
//
// These exist because "now" is the easiest thing in a date library to get silently wrong:
// at 09:07 local the instant reads 07:07, and code that picks the wrong one still runs.
// The assertions below pin each method to a *different* correct answer, so a future
// "simplification" that collapses them fails loudly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Now, ChronoInstant, ChronoPlain, ChronoZoned, UnknownTimeZoneError, ChronoDate } from '../lib/index.js';

/** The true local wall clock, read independently of chronofast. */
function wallClock(tz) {
  return new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
}

describe('Now — which clock is it?', () => {
  test('timeZoneId matches the host', () => {
    assert.equal(Now.timeZoneId(), new Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  test('instant() is the moment, and carries no calendar fields', () => {
    const before = Date.now();
    const t = Now.instant();
    assert.ok(t.ms >= before && t.ms <= Date.now());
    assert.equal(t.toISOString(), new Date(t.ms).toISOString());
    assert.ok(t instanceof ChronoInstant);
    for (const f of ['year', 'hour', 'dayOfWeek']) assert.equal(f in t, false, f);
  });

  test('plainDateTimeISO() returns a ChronoPlain, which has no moment to misread', () => {
    const p = Now.plainDateTimeISO();
    assert.ok(p instanceof ChronoPlain);
    assert.equal('epochMilliseconds' in p, false);
    assert.equal('toDate' in p, false);
  });

  test('epochMilliseconds() agrees with Date.now()', () => {
    const before = Date.now();
    const n = Now.epochMilliseconds();
    assert.ok(n >= before && n <= Date.now());
  });

  test('plainDateTimeISO() is the LOCAL wall clock, not UTC', () => {
    // The point of the whole namespace: this must read the local clock.
    const got = Now.plainDateTimeISO().toPlainISOString().slice(0, 16);
    const want = wallClock(Now.timeZoneId()).slice(0, 16);
    assert.equal(got, want);
  });

  test('plainDateTimeISO(tz) honours an explicit zone', () => {
    for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Chatham']) {
      assert.equal(Now.plainDateTimeISO(tz).toPlainISOString().slice(0, 16),
                   wallClock(tz).slice(0, 16), tz);
    }
  });

  test('zonedDateTimeISO() reads local while keeping the instant', () => {
    const z = Now.zonedDateTimeISO();
    assert.equal(z.hour, Number(wallClock(Now.timeZoneId()).slice(11, 13)));
    assert.ok(Math.abs(z.epochMilliseconds - Date.now()) < 5000, 'must be the current instant');
  });

  test('plainDateISO() is the local date, and carries no time at all', () => {
    const d = Now.plainDateISO();
    assert.equal(d.toISODate(), wallClock(Now.timeZoneId()).slice(0, 10));
    // It used to be a ChronoPlain pinned to midnight, so `.hour` read 0 and `.addHours(5)`
    // compiled - producing a value that was no longer a date. It is a ChronoDate now, and
    // the absence is the assertion.
    assert.ok(d instanceof ChronoDate);
    for (const f of ['hour', 'minute', 'second', 'millisecond', 'addHours']) {
      assert.equal(f in d, false, f);
    }
    assert.equal(d.toPlain().hour, 0, 'a midnight reading is still one call away');
  });

  test('plainDateISO(tz) can differ from the UTC date, which is the whole point', () => {
    // Somewhere on earth it is a different date right now; check both extremes agree with
    // an independent reading rather than with each other.
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Midway', 'UTC']) {
      assert.equal(Now.plainDateISO(tz).toISODate(), wallClock(tz).slice(0, 10), tz);
    }
  });

  test('minutesSinceMidnight() matches the local clock', () => {
    const w = wallClock(Now.timeZoneId());
    const expected = Number(w.slice(11, 13)) * 60 + Number(w.slice(14, 16));
    assert.ok(Math.abs(Now.minutesSinceMidnight() - expected) <= 1);
  });

  test('the readings differ from UTC by exactly the zone offset', () => {
    const tz = 'Asia/Kolkata';                     // +05:30, never any DST
    const instant = Now.instant();
    const plain = Now.plainDateTimeISO(tz);
    const zoned = Now.zonedDateTimeISO(tz);

    // plain and zoned describe the same wall clock
    assert.equal(plain.hour, zoned.hour);
    assert.equal(plain.minute, zoned.minute);

    // and that wall clock is UTC shifted by exactly +05:30.
    // Note `instant.hour` does not exist - a moment has no fields - so the UTC reading has
    // to be asked for by name. That is the split doing its job.
    const utc = instant.toUtcPlain();
    const utcMinutes = utc.hour * 60 + utc.minute;
    const localMinutes = plain.hour * 60 + plain.minute;
    const delta = ((localMinutes - utcMinutes) % 1440 + 1440) % 1440;
    assert.ok(Math.abs(delta - 330) <= 1, `expected a +330 minute shift, measured ${delta}`);
  });

  test('an unknown zone throws rather than silently falling back', () => {
    assert.throws(() => Now.plainDateTimeISO('Not/AZone'), UnknownTimeZoneError);
    assert.throws(() => Now.zonedDateTimeISO('Not/AZone'), UnknownTimeZoneError);
    assert.throws(() => Now.plainDateISO('Not/AZone'), UnknownTimeZoneError);
  });

  test('refreshTimeZone re-reads without breaking anything', () => {
    const first = Now.timeZoneId();
    Now.refreshTimeZone();
    assert.equal(Now.timeZoneId(), first);
  });

  test('Now is frozen-ish: the shape cannot be extended by accident', () => {
    assert.deepEqual(Object.keys(Now).sort(), [
      'epochMilliseconds', 'instant', 'minutesSinceMidnight', 'plainDateISO',
      'plainDateTimeISO', 'refreshTimeZone', 'timeZoneId', 'zonedDateTimeISO',
    ]);
  });
});

describe('toPlainISOString — the zone-free serialisation', () => {
  const cases = [
    ['2024-03-15T10:30:00.000Z', '2024-03-15T10:30:00'],
    ['2024-03-15T10:30:00.500Z', '2024-03-15T10:30:00.5'],
    ['2024-03-15T10:30:00.050Z', '2024-03-15T10:30:00.05'],
    ['2024-03-15T10:30:00.005Z', '2024-03-15T10:30:00.005'],
    ['2024-03-15T10:30:00.123Z', '2024-03-15T10:30:00.123'],
    ['2024-03-15T10:30:00.100Z', '2024-03-15T10:30:00.1'],
    ['2024-03-15T10:30:00.120Z', '2024-03-15T10:30:00.12'],
    ['1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00'],
    ['2024-12-31T23:59:59.999Z', '2024-12-31T23:59:59.999'],
    ['0001-01-01T00:00:00.000Z', '0001-01-01T00:00:00'],
  ];
  for (const [input, expected] of cases) {
    test(expected, () => assert.equal(ChronoPlain.parse(input).toPlainISOString(), expected));
  }

  test('never emits a Z or an offset', () => {
    for (let i = 0; i < 2000; i++) {
      const s = new ChronoPlain(i * 987_654_321).toPlainISOString();
      assert.ok(!s.includes('Z'), s);
      assert.ok(!/[+]\d\d:\d\d$/.test(s), s);
    }
  });

  test('round trips back through parse', () => {
    for (let i = 0; i < 2000; i++) {
      const t = new ChronoPlain(i * 987_654_321);
      assert.equal(ChronoPlain.parse(t.toPlainISOString()).wall, t.wall);
    }
  });

  test('differs from a moment toISOString by the designator and padding', () => {
    assert.equal(ChronoInstant.parse('2024-03-15T10:30:00.000Z').toISOString(), '2024-03-15T10:30:00.000Z');
    assert.equal(ChronoPlain.parse('2024-03-15T10:30:00.000').toPlainISOString(), '2024-03-15T10:30:00');
  });
});

describe('the documented migration equivalences hold', () => {
  test('Now.plainDateTimeISO(tz) equals instant -> inZone -> toPlain', () => {
    const tz = 'Europe/Bratislava';
    const a = Now.plainDateTimeISO(tz).toPlainISOString().slice(0, 16);
    const b = Now.instant().inZone(tz).toPlain().toPlainISOString().slice(0, 16);
    assert.equal(a, b);
  });

  test('Now.plainDateISO(tz) equals the zoned start of day, read plainly', () => {
    const tz = 'America/New_York';
    assert.equal(Now.plainDateISO(tz).toISODate(),
                 Now.instant().inZone(tz).startOfDay().toPlain().toISODate());
  });

  test('a wall-clock value survives a round trip through a zone', () => {
    const tz = 'Europe/Bratislava';
    const plain = Now.plainDateTimeISO(tz);
    const back = ChronoZoned.parse(plain.toPlainISOString(), tz).toPlain();
    assert.equal(back.toPlainISOString(), plain.toPlainISOString());
  });
});

describe('operator comparison and differences', () => {
  test('readings order numerically, not by ISO string', () => {
    // Regression: with no valueOf, `<` fell back to comparing the ISO text, so an expanded
    // year sorted before a four-digit one because '+' precedes '2'.
    const far = ChronoPlain.parse('+010000-01-01T00:00');
    const near = ChronoPlain.parse('2024-03-15T10:00');
    assert.equal(far < near, false, 'year 10000 must not sort before 2024');
    assert.equal(far > near, true);
    assert.equal(far < near, far.wall < near.wall, 'operator must agree with the value');
  });

  test('all four relational operators work on each type', () => {
    const a = ChronoInstant.parse('2024-03-15T10:00:00.000Z');
    const b = a.addHours(3);
    assert.ok(a < b); assert.ok(b > a); assert.ok(a <= a); assert.ok(a >= a);

    const p = ChronoPlain.parse('2024-03-15T10:00');
    const q = p.addHours(3);
    assert.ok(p < q); assert.ok(q > p); assert.ok(p <= p); assert.ok(p >= p);

    const z = ChronoZoned.fromLocal('Europe/Bratislava', 2024, 3, 15, 10, 0);
    const w = z.addHours(3);
    assert.ok(z < w); assert.ok(w > z); assert.ok(z <= z); assert.ok(z >= z);
  });

  test('sorting works through the operators for each type', () => {
    const mk = (h) => ChronoPlain.parse(`2024-03-15T${String(h).padStart(2, '0')}:00`);
    const xs = [mk(9), mk(3), mk(21), mk(12)];
    xs.sort(ChronoPlain.compare);
    assert.deepEqual(xs.map((x) => x.hour), [3, 9, 12, 21]);
  });

  test('difference methods, since TypeScript rejects `-` on objects', () => {
    const a = ChronoInstant.parse('2024-03-15T10:00:00.000Z');
    const b = a.addHours(3).addMinutes(30);
    assert.equal(a.millisecondsUntil(b), 12_600_000);
    assert.equal(a.secondsUntil(b), 12_600);
    assert.equal(a.minutesUntil(b), 210);
    assert.equal(a.hoursUntil(b), 3, 'truncates toward zero');
    assert.equal(b.hoursUntil(a), -3, 'and toward zero on the negative side too');
    assert.equal(a.daysUntil(a.addDays(9).addHours(23)), 9);
  });

  test('ChronoZoned.daysUntil counts calendar days across a DST boundary', () => {
    const tz = 'Europe/Bratislava';
    const before = ChronoZoned.fromLocal(tz, 2024, 3, 30, 12, 0);
    const after = ChronoZoned.fromLocal(tz, 2024, 3, 31, 12, 0);
    assert.equal(before.millisecondsUntil(after) / 3_600_000, 23, 'only 23 hours elapsed');
    assert.equal(before.daysUntil(after), 1, 'but it is still one calendar day');
  });

  test('plain differences ignore DST entirely, because a reading has none', () => {
    const p = ChronoPlain.parse('2024-03-30T12:00');
    assert.equal(p.hoursUntil(p.addDays(1)), 24);
  });
});
