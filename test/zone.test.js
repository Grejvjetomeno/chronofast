// The timezone engine. This is the part with real machinery behind it — an interval cache,
// a binary search for transition instants, and a wall-clock resolver with four
// disambiguation modes — so it gets the most testing.
//
// The cache is process-global and stateful, so a recurring theme below is interleaving:
// several zones at once, forwards and backwards through time, transition days revisited.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  offsetAt, offsetAtUncached, utcFromWall, formatZoned, toZonedISODate,
  startOfDayZoned, addDaysZoned, addMonthsZoned, zonedFields,
  zoneStats, resetZoneCaches, hasFastOffsetPath, formatLocale, localeFormatterCount,
  AmbiguousTimeError,
} from '../lib/zone.js';
import { parseISO, cY, cM, cD, cH, MS_HOUR } from '../lib/core.js';
import { ChronoZoned, ChronoInstant, ChronoPlain } from '../lib/index.js';
import { ZONES, scattered, clustered } from './helpers.js';

const at = (s) => parseISO(s);
const H = 3_600_000;

describe('offsetAt — known values', () => {
  const cases = [
    ['UTC is always zero', 'UTC', '2024-06-15T12:00:00Z', 0],
    ['Bratislava winter is +01:00', 'Europe/Bratislava', '2024-01-15T12:00:00Z', 1 * H],
    ['Bratislava summer is +02:00', 'Europe/Bratislava', '2024-06-15T12:00:00Z', 2 * H],
    ['New York winter is -05:00', 'America/New_York', '2024-01-15T12:00:00Z', -5 * H],
    ['New York summer is -04:00', 'America/New_York', '2024-06-15T12:00:00Z', -4 * H],
    ['Kolkata is always +05:30', 'Asia/Kolkata', '2024-06-15T12:00:00Z', 5.5 * H],
    ['Kolkata in winter too', 'Asia/Kolkata', '2024-01-15T12:00:00Z', 5.5 * H],
    ['Kathmandu is +05:45', 'Asia/Kathmandu', '2024-06-15T12:00:00Z', 5.75 * H],
    ['Chatham summer is +13:45', 'Pacific/Chatham', '2024-01-15T12:00:00Z', 13.75 * H],
    ['Chatham winter is +12:45', 'Pacific/Chatham', '2024-06-15T12:00:00Z', 12.75 * H],
    ['Lord Howe summer is +11:00', 'Australia/Lord_Howe', '2024-01-15T12:00:00Z', 11 * H],
    ['Lord Howe winter is +10:30', 'Australia/Lord_Howe', '2024-06-15T12:00:00Z', 10.5 * H],
    ['Sao Paulo after DST was abolished', 'America/Sao_Paulo', '2024-01-15T12:00:00Z', -3 * H],
    ['Adelaide is +09:30 in winter', 'Australia/Adelaide', '2024-06-15T12:00:00Z', 9.5 * H],
  ];
  for (const [name, tz, iso, expected] of cases) {
    test(name, () => assert.equal(offsetAt(tz, at(iso)), expected));
  }
});

describe('historical and range-edge offsets', () => {
  test('second-level historical offsets are preserved and round-trip', () => {
    const t = 0;
    const expected = -(44 * 60 + 30) * 1000;
    assert.equal(offsetAtUncached('Africa/Monrovia', t), expected);
    assert.equal(offsetAt('Africa/Monrovia', t), expected);
    const text = formatZoned('Africa/Monrovia', t);
    assert.equal(text, '1969-12-31T23:15:30.000-00:44:30');
    assert.equal(parseISO(text), t);
  });

  test('the valid ECMAScript time-value endpoints do not probe beyond Intl range', () => {
    for (const t of [-8.64e15, 8.64e15]) {
      assert.equal(offsetAt('UTC', t), 0);
      assert.equal(offsetAt('UTC', t), 0, 'cached lookup remains valid');
      assert.equal(utcFromWall('UTC', t), t);
    }
  });

  test('wall-time resolution cannot move a boundary value outside the instant range', () => {
    assert.throws(
      () => ChronoPlain.parse('+275760-09-13T00:00').assumeZone('Etc/GMT+12'),
      RangeError,
    );
    assert.throws(
      () => ChronoPlain.parse('-271821-04-20T00:00').assumeZone('Etc/GMT-12'),
      RangeError,
    );

    assert.equal(
      ChronoPlain.parse('+275760-09-13T00:00').assumeZone('Etc/GMT-12').isValid,
      true,
    );
    assert.equal(
      ChronoPlain.parse('-271821-04-20T00:00').assumeZone('Etc/GMT+12').isValid,
      true,
    );

    assert.equal(
      ChronoZoned.tryParse('+275760-09-13T00:00', 'Etc/GMT+12'),
      null,
    );
    assert.equal(
      ChronoZoned.tryParse('-271821-04-20T00:00', 'Etc/GMT-12'),
      null,
    );
  });
});

describe('offsetAt — DST transitions resolve to the second', () => {
  const transitions = [
    ['Europe/Bratislava', '2024-03-31T01:00:00Z', 1 * H, 2 * H, 'spring forward'],
    ['Europe/Bratislava', '2024-10-27T01:00:00Z', 2 * H, 1 * H, 'fall back'],
    ['America/New_York', '2024-03-10T07:00:00Z', -5 * H, -4 * H, 'spring forward'],
    ['America/New_York', '2024-11-03T06:00:00Z', -4 * H, -5 * H, 'fall back'],
    ['Pacific/Chatham', '2024-04-06T14:00:00Z', 13.75 * H, 12.75 * H, '45-minute zone'],
    ['Australia/Lord_Howe', '2024-04-06T15:00:00Z', 11 * H, 10.5 * H, '30-minute shift'],
  ];
  for (const [tz, isoAt, before, after, label] of transitions) {
    test(`${tz} ${label}`, () => {
      const t = at(isoAt);
      assert.equal(offsetAt(tz, t - 1), before, 'one ms before the transition');
      assert.equal(offsetAt(tz, t), after, 'at the transition instant');
      assert.equal(offsetAt(tz, t + 1), after, 'one ms after');
      assert.equal(offsetAt(tz, t - 60_000), before, 'a minute before');
      assert.equal(offsetAt(tz, t + 60_000), after, 'a minute after');
    });
  }
});

describe('offsetAt — the cache must never change the answer', () => {
  test('cached equals uncached, hourly across two years, every zone', () => {
    for (const { id } of ZONES) {
      resetZoneCaches();
      const start = at('2023-06-01T00:00:00Z');
      for (let h = 0; h < 24 * 730; h++) {
        const t = start + h * MS_HOUR;
        const a = offsetAt(id, t);
        const b = offsetAtUncached(id, t);
        if (a !== b) assert.fail(`${id} at ${new Date(t).toISOString()}: cached ${a}, uncached ${b}`);
      }
    }
  });

  test('answers do not depend on access order', () => {
    const tz = 'Europe/Bratislava';
    const probes = scattered(3000, 51).map((x) => Math.abs(x) % 4.7e12);
    resetZoneCaches();
    const forward = probes.map((t) => offsetAt(tz, t));
    resetZoneCaches();
    const backward = probes.slice().reverse().map((t) => offsetAt(tz, t)).reverse();
    resetZoneCaches();
    const shuffled = probes.map((_, i) => probes[(i * 7919) % probes.length])
      .map((t) => offsetAt(tz, t));
    assert.deepEqual(forward, backward, 'reverse traversal disagreed');
    for (let i = 0; i < probes.length; i++) {
      assert.equal(offsetAt(tz, probes[(i * 7919) % probes.length]), shuffled[i]);
    }
  });

  test('interleaving several zones does not corrupt the single-entry zone memo', () => {
    resetZoneCaches();
    const ids = ZONES.map((z) => z.id);
    const t = at('2024-06-15T12:00:00Z');
    const expected = ids.map((id) => offsetAtUncached(id, t));
    for (let round = 0; round < 200; round++) {
      for (let i = 0; i < ids.length; i++) {
        assert.equal(offsetAt(ids[i], t), expected[i], `${ids[i]} on round ${round}`);
      }
    }
  });

  test('revisiting a transition day repeatedly stays correct', () => {
    resetZoneCaches();
    const tz = 'Europe/Bratislava';
    const t = at('2024-03-31T01:00:00Z');
    for (let i = 0; i < 500; i++) {
      assert.equal(offsetAt(tz, t - 1), 1 * H);
      assert.equal(offsetAt(tz, t), 2 * H);
      assert.equal(offsetAt(tz, at('2024-06-15T12:00:00Z')), 2 * H);
      assert.equal(offsetAt(tz, at('2024-01-15T12:00:00Z')), 1 * H);
    }
  });

  test('the cache actually reduces Intl calls', () => {
    resetZoneCaches();
    const tz = 'Europe/Bratislava';
    const t0 = at('2024-01-01T00:00:00Z');
    const N = 20000;
    for (let i = 0; i < N; i++) offsetAt(tz, t0 + i * 60_000);
    const st = zoneStats(tz);
    assert.ok(st.intlCalls < N / 100, `expected far fewer than ${N / 100} Intl calls, got ${st.intlCalls}`);
    assert.ok(st.daysCached > 0);
  });

  test('resetZoneCaches clears state', () => {
    offsetAt('Europe/Bratislava', at('2024-06-15T12:00:00Z'));
    assert.ok(zoneStats('Europe/Bratislava').intlCalls > 0);
    resetZoneCaches();
    assert.equal(zoneStats('Europe/Bratislava'), null);
  });
});

describe('utcFromWall — disambiguation', () => {
  const tz = 'Europe/Bratislava';
  // 2024-03-31: 02:00 -> 03:00, so local 02:30 never happens.
  const gapWall = at('2024-03-31T02:30:00Z');
  // 2024-10-27: 03:00 -> 02:00, so local 02:30 happens twice.
  const ambiguousWall = at('2024-10-27T02:30:00Z');

  test('an unambiguous local time resolves exactly', () => {
    const wall = at('2024-06-15T12:00:00Z');
    assert.equal(utcFromWall(tz, wall), wall - 2 * H);
  });

  test('gap: compatible shifts forward', () => {
    assert.equal(new Date(utcFromWall(tz, gapWall)).toISOString(), '2024-03-31T01:30:00.000Z');
  });

  test('gap: reject throws', () => {
    assert.throws(() => utcFromWall(tz, gapWall, 'reject'), AmbiguousTimeError);
  });

  test('ambiguous: compatible picks the earlier', () => {
    assert.equal(new Date(utcFromWall(tz, ambiguousWall)).toISOString(), '2024-10-27T00:30:00.000Z');
  });

  test('ambiguous: earlier and later differ by exactly one hour', () => {
    const e = utcFromWall(tz, ambiguousWall, 'earlier');
    const l = utcFromWall(tz, ambiguousWall, 'later');
    assert.equal(l - e, 1 * H);
    assert.equal(e, utcFromWall(tz, ambiguousWall));   // compatible === earlier
  });

  test('ambiguous: reject throws', () => {
    assert.throws(() => utcFromWall(tz, ambiguousWall, 'reject'), AmbiguousTimeError);
  });

  test('round trip: wall -> instant -> wall is stable away from transitions', () => {
    for (const { id } of ZONES) {
      for (const ms of clustered(200, 52)) {
        const wall = ms + offsetAt(id, ms);
        const back = utcFromWall(id, wall);
        assert.equal(back + offsetAt(id, back), wall, `${id} at ${new Date(ms).toISOString()}`);
      }
    }
  });
});

describe('zoned formatting', () => {
  const cases = [
    ['UTC', '2024-06-15T12:00:00.000Z', '2024-06-15T12:00:00.000+00:00'],
    ['Europe/Bratislava', '2024-01-15T12:00:00.000Z', '2024-01-15T13:00:00.000+01:00'],
    ['Europe/Bratislava', '2024-06-15T12:00:00.000Z', '2024-06-15T14:00:00.000+02:00'],
    ['America/New_York', '2024-01-15T12:00:00.000Z', '2024-01-15T07:00:00.000-05:00'],
    ['Asia/Kolkata', '2024-06-15T12:00:00.000Z', '2024-06-15T17:30:00.000+05:30'],
    ['Asia/Kathmandu', '2024-06-15T12:00:00.000Z', '2024-06-15T17:45:00.000+05:45'],
    ['Pacific/Chatham', '2024-06-15T12:00:00.000Z', '2024-06-16T00:45:00.000+12:45'],
    ['Australia/Lord_Howe', '2024-06-15T12:00:00.000Z', '2024-06-15T22:30:00.000+10:30'],
  ];
  for (const [tz, iso, expected] of cases) {
    test(`${tz} ${iso}`, () => assert.equal(formatZoned(tz, at(iso)), expected));
  }

  test('toZonedISODate gives the LOCAL day, which can differ from the UTC day', () => {
    const t = at('2024-06-15T23:00:00Z');
    assert.equal(toZonedISODate('UTC', t), '2024-06-15');
    assert.equal(toZonedISODate('Europe/Bratislava', t), '2024-06-16', 'ahead of UTC');
    assert.equal(toZonedISODate('America/New_York', t), '2024-06-15', 'behind UTC');
    const u = at('2024-06-15T02:00:00Z');
    assert.equal(toZonedISODate('America/New_York', u), '2024-06-14', 'previous local day');
  });

  test('the local-day memo does not leak across zones', () => {
    const t = at('2024-06-15T23:00:00Z');
    for (let i = 0; i < 500; i++) {
      assert.equal(toZonedISODate('Europe/Bratislava', t), '2024-06-16');
      assert.equal(toZonedISODate('America/New_York', t), '2024-06-15');
      assert.equal(toZonedISODate('UTC', t), '2024-06-15');
    }
  });
});

describe('calendar arithmetic in a zone', () => {
  const tz = 'Europe/Bratislava';

  test('adding a day across spring forward moves 23 hours', () => {
    const t = at('2024-03-30T12:00:00Z');
    assert.equal((addDaysZoned(tz, t, 1) - t) / H, 23);
  });

  test('adding a day across fall back moves 25 hours', () => {
    const t = at('2024-10-26T12:00:00Z');
    assert.equal((addDaysZoned(tz, t, 1) - t) / H, 25);
  });

  test('adding a day away from a transition moves 24 hours', () => {
    const t = at('2024-06-15T12:00:00Z');
    assert.equal((addDaysZoned(tz, t, 1) - t) / H, 24);
  });

  test('the local wall-clock time is preserved across a transition', () => {
    const t = at('2024-03-30T12:00:00Z');
    assert.equal(formatZoned(tz, t).slice(11, 19), '13:00:00');
    assert.equal(formatZoned(tz, addDaysZoned(tz, t, 1)).slice(11, 19), '13:00:00');
  });

  test('addMonthsZoned preserves local time and clamps', () => {
    const t = at('2024-01-31T12:00:00Z');
    assert.equal(toZonedISODate(tz, addMonthsZoned(tz, t, 1)), '2024-02-29');
  });

  test('startOfDayZoned is local midnight', () => {
    const t = at('2024-06-15T12:00:00Z');
    assert.equal(formatZoned(tz, startOfDayZoned(tz, t)), '2024-06-15T00:00:00.000+02:00');
  });

  test('startOfDayZoned is idempotent', () => {
    for (const { id } of ZONES) {
      for (const ms of clustered(100, 53)) {
        const s = startOfDayZoned(id, ms);
        assert.equal(startOfDayZoned(id, s), s, `${id}`);
      }
    }
  });

  test('startOfDayZoned lands on a real instant even when local midnight does not exist', () => {
    // Cuba skipped midnight on 2024-03-10; Chile and Brazil have done the same.
    for (const [zone, iso] of [['America/Havana', '2024-03-10T12:00:00Z'],
                               ['America/Santiago', '2024-09-08T12:00:00Z']]) {
      const t = at(iso);
      const s = startOfDayZoned(zone, t);
      assert.ok(Number.isFinite(s), `${zone} produced a non-finite instant`);
      assert.ok(s <= t, `${zone} start of day is after the instant`);
      assert.ok(t - s < 26 * H, `${zone} start of day is more than 26h back`);
    }
  });
});

describe('zonedFields writes the local wall clock into the scratch slots', () => {
  test('Bratislava in summer is two hours ahead', () => {
    zonedFields('Europe/Bratislava', at('2024-06-15T12:00:00Z'));
    assert.deepEqual([cY, cM, cD, cH], [2024, 6, 15, 14]);
  });
  test('New York in winter is five hours behind', () => {
    zonedFields('America/New_York', at('2024-01-15T12:00:00Z'));
    assert.deepEqual([cY, cM, cD, cH], [2024, 1, 15, 7]);
  });
  test('crossing the local date line backwards', () => {
    zonedFields('America/New_York', at('2024-06-15T02:00:00Z'));
    assert.deepEqual([cY, cM, cD, cH], [2024, 6, 14, 22]);
  });
});

describe('ChronoZoned', () => {
  test('inZone preserves the instant', () => {
    const t = ChronoInstant.parse('2024-06-15T12:00:00.000Z');
    assert.equal(t.inZone('Asia/Kolkata').epochMilliseconds, t.ms);
  });

  test('fields are local, the instant is not', () => {
    const z = ChronoInstant.parse('2024-06-15T12:00:00.000Z').inZone('Asia/Kolkata');
    assert.equal(z.hour, 17);
    assert.equal(z.minute, 30);
    assert.equal(z.offset, 5.5 * H);
    assert.equal(z.offsetHours, 5.5);
  });

  test('fromLocal resolves wall-clock fields', () => {
    const z = ChronoZoned.fromLocal('Europe/Bratislava', 2024, 6, 15, 14, 0);
    assert.equal(z.toInstant().toISOString(), '2024-06-15T12:00:00.000Z');
  });

  test('fromLocal on a nonexistent local time shifts forward', () => {
    const z = ChronoZoned.fromLocal('Europe/Bratislava', 2024, 3, 31, 2, 30);
    assert.equal(z.toISOString(), '2024-03-31T03:30:00.000+02:00');
  });

  test('fromLocal with reject throws on an ambiguous time', () => {
    assert.throws(
      () => ChronoZoned.fromLocal('Europe/Bratislava', 2024, 10, 27, 2, 30, 0, 0, 'reject'),
      AmbiguousTimeError);
  });

  test('exact-time units ignore DST, calendar units do not', () => {
    const z = ChronoZoned.fromEpochMs(at('2024-03-30T12:00:00Z'), 'Europe/Bratislava');
    assert.equal((z.addHours(24).epochMilliseconds - z.epochMilliseconds) / H, 24);
    assert.equal((z.addDays(1).epochMilliseconds - z.epochMilliseconds) / H, 23);
  });

  test('withZone keeps the instant and changes the reading', () => {
    const z = ChronoZoned.fromEpochMs(at('2024-06-15T12:00:00Z'), 'UTC');
    const w = z.withZone('Asia/Kolkata');
    assert.equal(w.epochMilliseconds, z.epochMilliseconds);
    assert.equal(w.hour, 17);
    assert.equal(z.hour, 12, 'the original must not change');
  });

  test('methods are immutable', () => {
    const z = ChronoZoned.fromEpochMs(at('2024-06-15T12:00:00Z'), 'Europe/Bratislava');
    const before = z.epochMilliseconds;
    for (const op of ['addHours', 'addMinutes', 'addSeconds', 'addDays', 'addMonths', 'addYears']) {
      const r = z[op](2);
      assert.notEqual(r, z, `${op} returned the receiver`);
      assert.equal(z.epochMilliseconds, before, `${op} mutated the receiver`);
    }
    assert.equal(z.startOfDay().epochMilliseconds <= before, true);
    assert.equal(z.epochMilliseconds, before);
  });

  test('toString carries the zone id, toISOString does not', () => {
    const z = ChronoZoned.fromEpochMs(at('2024-06-15T12:00:00Z'), 'Europe/Bratislava');
    assert.equal(z.toISOString(), '2024-06-15T14:00:00.000+02:00');
    assert.equal(z.toString(), '2024-06-15T14:00:00.000+02:00[Europe/Bratislava]');
    assert.equal(z.toJSON(), z.toISOString());
  });
});

describe('capability reporting', () => {
  test('hasFastOffsetPath returns a boolean', () => {
    assert.equal(typeof hasFastOffsetPath(), 'boolean');
  });
});

test('resetZoneCaches drops the locale formatter cache too', () => {
  formatLocale(0, 'UTC', 'en-US', { dateStyle: 'full' }, 1);
  assert.ok(localeFormatterCount() > 0);
  resetZoneCaches();
  assert.equal(localeFormatterCount(), 0);
});

describe('a zone designator decides what a string means', () => {
  const TZ = 'Europe/Bratislava';

  test('no designator is a wall-clock reading in the zone', () => {
    // The case that motivated this: 10:00 known to be Bratislava must stay 10:00.
    const z = ChronoZoned.parse('2000-09-01T10:00', TZ);
    assert.equal(z.toISOString(), '2000-09-01T10:00:00.000+02:00');
    assert.equal(z.toInstant().toISOString(), '2000-09-01T08:00:00.000Z');
  });

  test('a trailing Z is an exact instant, merely displayed in the zone', () => {
    const z = ChronoZoned.parse('2000-09-01T10:00:00Z', TZ);
    assert.equal(z.toISOString(), '2000-09-01T12:00:00.000+02:00');
  });

  test('an explicit offset wins over the zone for the instant', () => {
    const z = ChronoZoned.parse('2000-09-01T10:00:00+05:00', TZ);
    assert.equal(z.toInstant().toISOString(), '2000-09-01T05:00:00.000Z');
    assert.equal(z.toISOString(), '2000-09-01T07:00:00.000+02:00');
  });

  test('a date-only string is a local date, i.e. local midnight', () => {
    assert.equal(ChronoZoned.parse('2000-09-01', TZ).toISOString(), '2000-09-01T00:00:00.000+02:00');
  });

  test('a designator on an accepted date-only string still names an instant', () => {
    assert.equal(ChronoZoned.parse('2000-09-01Z', TZ).toInstant().toISOString(),
                 '2000-09-01T00:00:00.000Z');
    assert.equal(ChronoZoned.parse('2000-09-01+02:00', TZ).toInstant().toISOString(),
                 '2000-08-31T22:00:00.000Z');
  });

  test('the offset used is the one in force on that date, not a fixed guess', () => {
    assert.equal(ChronoZoned.parse('2000-01-15T10:00', TZ).toISOString(), '2000-01-15T10:00:00.000+01:00');
    assert.equal(ChronoZoned.parse('2000-07-15T10:00', TZ).toISOString(), '2000-07-15T10:00:00.000+02:00');
  });

  test('a lowercase z still counts as a designator', () => {
    assert.equal(ChronoZoned.parse('2000-09-01T10:00:00z', TZ).toInstant().toISOString(),
                 '2000-09-01T10:00:00.000Z');
  });

  test('an expanded year without a designator is still wall time', () => {
    const z = ChronoZoned.parse('+002000-09-01T10:00', TZ);
    assert.equal(z.toISOString(), '2000-09-01T10:00:00.000+02:00');
  });

  test('malformed input throws rather than being reinterpreted', () => {
    assert.throws(() => ChronoZoned.parse('nonsense', TZ), RangeError);
    assert.equal(ChronoZoned.tryParse('nonsense', TZ), null);
  });

  test('disambiguation is honoured for a nonexistent local time', () => {
    assert.equal(ChronoZoned.parse('2024-03-31T02:30', TZ).toISOString(),
                 '2024-03-31T03:30:00.000+02:00');
    assert.throws(() => ChronoZoned.parse('2024-03-31T02:30', TZ, 'reject'), AmbiguousTimeError);
  });

  test('disambiguation is honoured for an ambiguous local time', () => {
    const earlier = ChronoZoned.parse('2024-10-27T02:30', TZ, 'earlier');
    const later = ChronoZoned.parse('2024-10-27T02:30', TZ, 'later');
    assert.equal(later.epochMilliseconds - earlier.epochMilliseconds, H);
    assert.throws(() => ChronoZoned.parse('2024-10-27T02:30', TZ, 'reject'), AmbiguousTimeError);
  });

  test('parse agrees with fromLocal for the same fields', () => {
    for (const [y, mo, d, h, mi] of [[2000, 9, 1, 10, 0], [2024, 1, 15, 23, 59], [2024, 7, 4, 0, 0]]) {
      const p = (n, w) => String(n).padStart(w, '0');
      const str = `${p(y, 4)}-${p(mo, 2)}-${p(d, 2)}T${p(h, 2)}:${p(mi, 2)}`;
      assert.equal(ChronoZoned.parse(str, TZ).epochMilliseconds,
                   ChronoZoned.fromLocal(TZ, y, mo, d, h, mi).epochMilliseconds, str);
    }
  });
});

describe('inZone (a moment) vs assumeZone (a reading)', () => {
  const TZ = 'Europe/Bratislava';
  const t = ChronoInstant.parse('2000-09-01T10:00:00.000Z');
  const p = ChronoPlain.parse('2000-09-01T10:00:00.000');

  test('inZone keeps the moment and moves the reading', () => {
    assert.equal(t.inZone(TZ).epochMilliseconds, t.ms);
    assert.equal(t.inZone(TZ).hour, 12);
  });

  test('assumeZone keeps the reading and produces a moment', () => {
    assert.equal(p.assumeZone(TZ).hour, 10);
    assert.equal(p.assumeZone(TZ).epochMilliseconds, t.ms - 2 * H);
  });

  test('assumeZone preserves every field, for every zone', () => {
    for (const { id } of ZONES) {
      const z = p.assumeZone(id);
      assert.equal(z.year, p.year, id);
      assert.equal(z.month, p.month, id);
      assert.equal(z.day, p.day, id);
      assert.equal(z.hour, p.hour, id);
      assert.equal(z.minute, p.minute, id);
    }
  });

  test('assumeZone then toPlain round trips', () => {
    for (const { id } of ZONES) {
      assert.equal(p.assumeZone(id).toPlain().wall, p.wall, id);
    }
  });

  test('toUtcPlain then assumeZone is the documented reinterpretation', () => {
    assert.equal(t.toUtcPlain().assumeZone(TZ).hour, 10);
    assert.equal(t.toUtcPlain().assumeZone(TZ).epochMilliseconds, t.ms - 2 * H);
  });

  test('assumeZone honours disambiguation', () => {
    const gap = ChronoPlain.parse('2024-03-31T02:30:00.000');
    assert.equal(gap.assumeZone(TZ).toISOString(), '2024-03-31T03:30:00.000+02:00');
    assert.throws(() => gap.assumeZone(TZ, 'reject'), AmbiguousTimeError);
  });

  test('assumeZone rejects an unknown zone', () => {
    assert.throws(() => p.assumeZone('Not/AZone'), Error);
  });
});

describe('withZone vs withZoneSameLocal', () => {
  const z = ChronoZoned.fromLocal('Europe/London', 2024, 6, 15, 9, 0);

  test('withZone keeps the instant', () => {
    const w = z.withZone('America/New_York');
    assert.equal(w.epochMilliseconds, z.epochMilliseconds);
    assert.equal(w.hour, 4);
  });

  test('withZoneSameLocal keeps the wall clock', () => {
    const w = z.withZoneSameLocal('America/New_York');
    assert.equal(w.hour, 9);
    assert.equal(w.minute, 0);
    assert.equal(w.epochMilliseconds - z.epochMilliseconds, 5 * H);
  });

  test('withZoneSameLocal to the same zone is identity', () => {
    for (const { id } of ZONES) {
      const a = ChronoZoned.fromLocal(id, 2024, 6, 15, 9, 0);
      assert.equal(a.withZoneSameLocal(id).epochMilliseconds, a.epochMilliseconds, id);
    }
  });
});
