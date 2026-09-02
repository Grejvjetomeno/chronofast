// Invalid values must fail loudly, never serialise to something that looks like a date.
//
// Regression: `toISO` builds its result with one `String.fromCharCode(...)` call whose digit
// arguments are computed arithmetically. On a NaN instant every argument was NaN, and
// `String.fromCharCode(NaN)` is U+0000 - so an invalid moment serialised to
// "000<NUL>-03-0<NUL>T00:00:00.00<NUL>Z". That is close enough to a timestamp to travel: into
// JSON, then into storage, where Postgres rejects NUL in text and jsonb far away from the
// parse that produced it. The contract below is Date's, exactly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ChronoInstant, ChronoPlain, ChronoZoned, InvalidInstantError } from '../lib/index.js';
import { toISO, toISODate } from '../lib/core.js';

const INVALID = /^Invalid time value$/;
const hasNul = (s) => typeof s === 'string' && s.includes('\u0000');

describe('invalid values never emit NUL bytes', () => {
  // The parsing doors now throw, so an invalid value can only be reached by handing a raw
  // NaN to a constructor. These are the routes that remain, and they must still not emit
  // a string that looks like a timestamp.
  const routes = {
    'new ChronoInstant(NaN)': () => new ChronoInstant(NaN),
    'arithmetic on a NaN instant': () => new ChronoInstant(NaN).addDays(7).addHours(3),
    'new ChronoPlain(NaN)': () => new ChronoPlain(NaN),
    'arithmetic on a NaN plain': () => new ChronoPlain(NaN).addMonths(1).startOfDay(),
    'new ChronoZoned(NaN, tz)': () => new ChronoZoned(NaN, 'Europe/Bratislava'),
  };

  for (const [name, make] of Object.entries(routes)) {
    test(name, () => {
      const v = make();
      assert.equal(v.isValid, false, 'must report itself invalid');
      for (const m of ['toISOString', 'toISODate', 'toString', 'toJSON', 'toPlainISOString']) {
        if (typeof v[m] !== 'function') continue;
        let out;
        try { out = v[m](); } catch (e) {
          assert.ok(e instanceof RangeError, `${m} threw ${e.constructor.name}, want RangeError`);
          assert.match(e.message, INVALID);
          continue;
        }
        assert.equal(hasNul(out), false, `${m} emitted a NUL byte: ${JSON.stringify(out)}`);
      }
    });
  }
});

describe('the invalid contract matches Date exactly', () => {
  const cases = [
    ['ChronoInstant', new ChronoInstant(NaN)],
    ['ChronoPlain', new ChronoPlain(NaN)],
    ['ChronoZoned', new ChronoZoned(NaN, 'Europe/Bratislava')],
  ];
  for (const [name, v] of cases) {
    test(`${name}.toString() is 'Invalid Date'`, () => {
      assert.equal(v.toString(), 'Invalid Date');
      assert.equal(v.toString(), new Date(NaN).toString());
    });
    test(`${name}.toJSON() is null`, () => {
      assert.equal(v.toJSON(), null);
      assert.equal(JSON.stringify({ v }), '{"v":null}');
      assert.equal(JSON.stringify({ v }), JSON.stringify({ v: new Date(NaN) }));
    });
  }

  test('serialisers throw RangeError, like Date#toISOString', () => {
    assert.throws(() => new ChronoInstant(NaN).toISOString(), { name: 'RangeError', message: 'Invalid time value' });
    assert.throws(() => new ChronoInstant(NaN).toISODate(), { name: 'RangeError' });
    assert.throws(() => new ChronoPlain(NaN).toPlainISOString(), { name: 'RangeError' });
    assert.throws(() => new ChronoPlain(NaN).toISODate(), { name: 'RangeError' });
    assert.throws(() => new ChronoZoned(NaN, 'UTC').toISOString(), { name: 'RangeError' });
    assert.throws(() => new Date(NaN).toISOString(), { name: 'RangeError' });
  });

  test('the raw layer is guarded too, not just the classes', () => {
    assert.throws(() => toISO(NaN), { name: 'RangeError', message: 'Invalid time value' });
    assert.throws(() => toISODate(NaN), { name: 'RangeError', message: 'Invalid time value' });
  });
});

describe('valid values are untouched by the guard', () => {
  test('100k random instants stay byte-identical to Date', () => {
    let seed = 5, bad = 0;
    for (let i = 0; i < 100_000; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const ms = Math.floor((seed / 0x7fffffff - 0.5) * 2 * 4.7e12);
      if (new ChronoInstant(ms).toISOString() !== new Date(ms).toISOString()) bad++;
    }
    assert.equal(bad, 0);
  });

  test('a valid value still round-trips through JSON', () => {
    const t = ChronoInstant.parse('2024-03-15T10:30:00.123Z');
    assert.equal(JSON.stringify({ t }), '{"t":"2024-03-15T10:30:00.123Z"}');
    assert.equal(ChronoInstant.parse(JSON.parse(JSON.stringify({ t })).t).ms, t.ms);
  });
});


describe('the parsing doors fail closed', () => {
  // Regression: `parse` used to return an instance whose `isValid` was false. A NaN makes
  // BOTH `a >= b` and `a < b` evaluate false, so a bad timestamp did not merely compare
  // wrong - it silently took the else-branch of every comparison downstream. Code that
  // asked "is this slot in the future?" answered "no" for a value it never understood.
  const MALFORMED = ['not-a-date', '', '   ', 'null', 'undefined', '2026-02-30T00:00:00',
                     '2026-13-01T00:00:00', '2026-01-01T25:00:00', '2026-01-01T00:60:00',
                     '2026-01-01T00:00:00+99:00', '15/03/2024', 'Mar 15 2024'];

  for (const bad of MALFORMED) {
    test(`ChronoInstant.parse(${JSON.stringify(bad)}) throws`, () => {
      assert.throws(() => ChronoInstant.parse(bad), InvalidInstantError);
      assert.throws(() => ChronoInstant.parse(bad), RangeError,
        'must stay a RangeError so Temporal catch blocks keep working');
    });
    test(`ChronoInstant.tryParse(${JSON.stringify(bad)}) is null`, () => {
      assert.equal(ChronoInstant.tryParse(bad), null);
    });
  }

  test('ChronoPlain and ChronoZoned fail closed the same way', () => {
    assert.throws(() => ChronoPlain.parse('not-a-date'), RangeError);
    assert.throws(() => ChronoZoned.parse('not-a-date', 'Europe/Bratislava'), RangeError);
    assert.equal(ChronoPlain.tryParse('not-a-date'), null);
    assert.equal(ChronoZoned.tryParse('not-a-date', 'Europe/Bratislava'), null);
  });

  test('fromDate refuses to launder an invalid Date into a NaN instant', () => {
    assert.throws(() => ChronoInstant.fromDate(new Date(NaN)), InvalidInstantError);
    assert.throws(() => ChronoInstant.fromDate(new Date('nope')), InvalidInstantError);
  });

  test('no comparison can be reached with an unparsed value', () => {
    // The shape of the original bug, asserted directly.
    const now = Date.now();
    assert.throws(() => {
      const t = ChronoInstant.parse('garbage-from-an-external-api');
      return t.epochMilliseconds >= now;
    }, RangeError);
  });

  test('the error names the input, so the log says which row was bad', () => {
    try { ChronoInstant.parse('15/03/2024'); assert.fail('should have thrown'); }
    catch (e) { assert.match(e.message, /15\/03\/2024/); }
  });

  test('well-formed input is completely unaffected', () => {
    assert.equal(ChronoInstant.parse('2024-03-15T10:30:00.123Z').toISOString(),
                 '2024-03-15T10:30:00.123Z');
    assert.equal(ChronoPlain.parse('2024-03-15T10:30:00').toPlainISOString(),
                 '2024-03-15T10:30:00');
    assert.equal(ChronoZoned.parse('2024-03-15T10:30', 'Europe/Bratislava').toISOString(),
                 '2024-03-15T10:30:00.000+01:00');
    assert.equal(ChronoInstant.tryParse('2024-03-15T10:30:00.123Z').toISOString(),
                 '2024-03-15T10:30:00.123Z');
  });
});

describe('sub-millisecond input truncates, exactly as Date.parse does', () => {
  // Not a bug, but it is silent, and Temporal keeps the digits chronofast drops. Pinned
  // here so the behaviour cannot change without someone deciding to change it.
  const cases = [
    ['2026-09-02T16:30:00.123456Z', '2026-09-02T16:30:00.123Z'],
    ['2026-09-02T16:30:00.999999Z', '2026-09-02T16:30:00.999Z'],
    ['2026-09-02T16:30:00.1234Z', '2026-09-02T16:30:00.123Z'],
    ['1969-12-31T23:59:59.123456Z', '1969-12-31T23:59:59.123Z'],
  ];
  for (const [input, expected] of cases) {
    test(`${input} -> ${expected}`, () => {
      assert.equal(ChronoInstant.parse(input).toISOString(), expected);
      assert.equal(ChronoInstant.parse(input).toISOString(), new Date(input).toISOString(),
        'must not diverge from Date.parse');
    });
  }
  test('microsecond input is accepted, not rejected - Postgres emits it by default', () => {
    assert.equal(ChronoInstant.parse('2026-09-02T16:30:00.123456Z').isValid, true);
  });
});
