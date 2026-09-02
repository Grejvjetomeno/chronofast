// Parsing. The library has TWO parse paths - a constant-index fast path for the canonical
// 24-character form, and a general scanner for everything else - so the central risk is
// that they drift apart. Most of what follows exists to catch that.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseISO } from '../lib/core.js';
import { ChronoInstant, InvalidInstantError } from '../lib/index.js';
import { EDGE_INSTANTS, scattered, isoCanonical, isoNoFraction, isoWithOffset, utc } from './helpers.js';

describe('parseISO — accepted forms', () => {
  const cases = [
    ['canonical, fast path', '2024-03-15T10:30:00.123Z', utc(2024, 3, 15, 10, 30, 0, 123)],
    ['no fractional seconds', '2024-03-15T10:30:00Z', utc(2024, 3, 15, 10, 30, 0)],
    ['no seconds', '2024-03-15T10:30Z', utc(2024, 3, 15, 10, 30)],
    ['date only (reads as UTC)', '2024-03-15', utc(2024, 3, 15)],
    ['no designator (reads as UTC)', '2024-03-15T10:30:00', utc(2024, 3, 15, 10, 30)],
    ['lowercase t and z', '2024-03-15t10:30:00z', utc(2024, 3, 15, 10, 30)],
    ['space separator', '2024-03-15 10:30:00Z', utc(2024, 3, 15, 10, 30)],
    ['positive offset', '2024-03-15T12:30:00.123+02:00', utc(2024, 3, 15, 10, 30, 0, 123)],
    ['negative offset', '2024-03-15T05:00:00.123-05:30', utc(2024, 3, 15, 10, 30, 0, 123)],
    ['offset without colon', '2024-03-15T12:30:00+0200', utc(2024, 3, 15, 10, 30)],
    ['offset hours only', '2024-03-15T12:30:00+02', utc(2024, 3, 15, 10, 30)],
    ['comma as decimal separator', '2024-03-15T10:30:00,5Z', utc(2024, 3, 15, 10, 30, 0, 500)],
    ['one fractional digit', '2024-03-15T10:30:00.5Z', utc(2024, 3, 15, 10, 30, 0, 500)],
    ['two fractional digits', '2024-03-15T10:30:00.05Z', utc(2024, 3, 15, 10, 30, 0, 50)],
    ['extra precision truncates, not rounds', '2024-03-15T10:30:00.999999999Z', utc(2024, 3, 15, 10, 30, 0, 999)],
    ['truncation does not round up', '2024-03-15T10:30:00.0009Z', utc(2024, 3, 15, 10, 30, 0, 0)],
    ['expanded year, positive', '+010000-01-01T00:00:00.000Z', Date.UTC(10000, 0, 1)],
    ['leap day', '2024-02-29T00:00:00.000Z', utc(2024, 2, 29)],
    ['leap day in a ÷400 year', '2000-02-29T00:00:00.000Z', utc(2000, 2, 29)],
    ['epoch', '1970-01-01T00:00:00.000Z', 0],
    ['end of a year', '2024-12-31T23:59:59.999Z', utc(2024, 12, 31, 23, 59, 59, 999)],
    ['offset crossing a day boundary', '2024-03-15T23:30:00+02:00', utc(2024, 3, 15, 21, 30)],
    ['offset crossing back a day', '2024-03-15T00:30:00-05:00', utc(2024, 3, 15, 5, 30)],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => assert.equal(parseISO(input), expected, input));
  }
});

describe('parseISO — rejected forms', () => {
  const bad = [
    ['month 13', '2024-13-01T00:00:00.000Z'],
    ['month 00', '2024-00-01T00:00:00.000Z'],
    ['day 00', '2024-03-00T00:00:00.000Z'],
    ['day 32', '2024-03-32T00:00:00.000Z'],
    ['Feb 30', '2024-02-30T00:00:00.000Z'],
    ['Feb 29 in a common year', '2023-02-29T00:00:00.000Z'],
    ['Feb 29 in a ÷100 non-leap year', '1900-02-29T00:00:00.000Z'],
    ['Apr 31', '2024-04-31T00:00:00.000Z'],
    ['hour 24', '2024-03-15T24:00:00.000Z'],
    ['hour 25', '2024-03-15T25:00:00.000Z'],
    ['minute 60', '2024-03-15T10:60:00.000Z'],
    ['second 60 (no leap seconds)', '2024-03-15T10:30:60.000Z'],
    ['letter in the day', '2024-03-1XT10:30:00.000Z'],
    ['letter in the year', '20X4-03-15T10:30:00.000Z'],
    ['letter in the fraction', '2024-03-15T10:30:00.12XZ'],
    ['trailing junk after Z', '2024-03-15T10:30:00.123ZZ'],
    ['bare dot with no digits', '2024-03-15T10:30:00.Z'],
    ['empty string', ''],
    ['year-month only', '2024-03'],
    ['not a date at all', 'not-a-date-at-all!!'],
    ['wrong separator', '2024/03/15T10:30:00Z'],
    ['offset minute 60', '2024-03-15T10:30:00+02:60'],
    ['offset hour 24', '2024-03-15T10:30:00+24:00'],
    ['negative expanded year zero', '-000000-01-01T00:00:00.000Z'],
    ['too short', '2024-03-1'],
  ];
  for (const [name, input] of bad) {
    test(name, () => assert.ok(Number.isNaN(parseISO(input)), `expected NaN for ${JSON.stringify(input)}`));
  }
});

describe('parseISO — the two paths must agree', () => {
  test('canonical vs no-fraction form, 5000 instants', () => {
    for (const ms of scattered(5000, 11)) {
      const truncated = ms - ((ms % 1000) + 1000) % 1000;   // drop sub-second
      assert.equal(parseISO(isoNoFraction(ms)), truncated, isoNoFraction(ms));
    }
  });

  test('canonical vs offset form, every offset, 2000 instants', () => {
    const offsets = [0, 60, -60, 120, -300, 330, 345, 570, -480, 765, -720];
    const inputs = scattered(2000, 12);
    for (let i = 0; i < inputs.length; i++) {
      const ms = inputs[i];
      const off = offsets[i % offsets.length];
      assert.equal(parseISO(isoWithOffset(ms, off)), ms, `offset ${off} on ${isoCanonical(ms)}`);
    }
  });

  test('a trailing Z and an explicit +00:00 agree', () => {
    for (const ms of scattered(500, 13)) {
      assert.equal(parseISO(isoCanonical(ms)), parseISO(isoWithOffset(ms, 0)));
    }
  });
});

describe('parseISO — agrees with Date where both accept the input', () => {
  for (const [name, ms] of EDGE_INSTANTS) {
    test(name, () => {
      const s = isoCanonical(ms);
      assert.equal(parseISO(s), Date.parse(s), s);
      assert.equal(parseISO(s), ms);
    });
  }
});

describe('parseISO — round trips', () => {
  test('parse(format(x)) === x for 20000 scattered instants', () => {
    for (const ms of scattered(20000, 14)) {
      assert.equal(parseISO(isoCanonical(ms)), ms);
    }
  });
});

describe('parse is stateless across calls', () => {
  // The parser memoises the civil-date conversion on the current y/m/d. Interleaving
  // unrelated days must not let a stale memo leak into the next result.
  test('interleaved days do not contaminate each other', () => {
    const a = '2024-03-15T10:30:00.000Z', b = '1998-11-03T22:15:45.500Z', c = '2031-07-15T00:00:00.001Z';
    const ea = utc(2024, 3, 15, 10, 30), eb = utc(1998, 11, 3, 22, 15, 45, 500), ec = utc(2031, 7, 15, 0, 0, 0, 1);
    for (let i = 0; i < 2000; i++) {
      assert.equal(parseISO(a), ea);
      assert.equal(parseISO(b), eb);
      assert.equal(parseISO(c), ec);
      assert.equal(parseISO(b), eb);
      assert.equal(parseISO(a), ea);
    }
  });

  test('same day different times', () => {
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 7) {
        const s = `2024-03-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
        assert.equal(parseISO(s), utc(2024, 3, 15, h, m), s);
      }
    }
  });
});

describe('ChronoInstant.parse mirrors parseISO', () => {
  test('valid input', () => {
    for (const ms of scattered(2000, 15)) {
      assert.equal(ChronoInstant.parse(isoCanonical(ms)).ms, ms);
    }
  });
  test('invalid input throws rather than yielding a NaN-carrying instance', () => {
    // The old contract returned an instance with isValid === false. It was withdrawn:
    // a NaN makes BOTH `a >= b` and `a < b` false, so a bad timestamp silently took the
    // else-branch of every downstream comparison instead of surfacing.
    assert.throws(() => ChronoInstant.parse('nonsense'), InvalidInstantError);
    assert.throws(() => ChronoInstant.parse('nonsense'), RangeError);
  });
  test('tryParse is the non-throwing door, and returns null', () => {
    assert.equal(ChronoInstant.tryParse('nonsense'), null);
    assert.equal(ChronoInstant.tryParse('2024-03-15T10:30:00.000Z').toISOString(),
                 '2024-03-15T10:30:00.000Z');
  });
  test('valid input reports isValid === true', () => {
    assert.equal(ChronoInstant.parse('2024-03-15T10:30:00.000Z').isValid, true);
  });
});
