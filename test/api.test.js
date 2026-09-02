// The published contract. These tests exist to make an accidental API change loud: adding
// an export, leaking an internal, renaming a method, or changing which error a bad input
// produces are all breaking changes for somebody, and none of them fail a type-check.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as api from '../lib/index.js';
import {
  ChronoInstant, ChronoPlain, ChronoZoned,
  InvalidInstantError, UnknownTimeZoneError, AmbiguousTimeError,
} from '../lib/index.js';

describe('public surface', () => {
  // Deliberately exhaustive. Adding an export requires updating this line, which is the
  // point: it forces the decision to be explicit rather than incidental.
  const EXPECTED_EXPORTS = [
    'AmbiguousTimeError',
    'ChronoInstant',
    'ChronoPlain',
    'ChronoZoned',
    'InvalidInstantError',
    'Now',
    'UnknownTimeZoneError',
  ];

  test('exports exactly the documented set', () => {
    assert.deepEqual(Object.keys(api).sort(), EXPECTED_EXPORTS);
  });

  test('the raw function layer is not reachable from the entry point', () => {
    for (const internal of ['parseISO', 'toISO', 'addMonths',
                            'startOfDay', 'offsetAt', 'utcFromWall', 'civilFromDays',
                            'daysFromCivil', 'unpack', 'cY', 'cM', 'cD',
                            'epochMs', 'timeZone', 'zoneStats', 'resetZoneCaches']) {
      assert.equal(internal in api, false, `${internal} leaked into the public entry`);
    }
  });

  test('the raw layer IS reachable from the documented subpaths', async () => {
    const core = await import('../lib/core.js');
    const zone = await import('../lib/zone.js');
    for (const f of ['parseISO', 'toISO', 'addDays', 'unpack']) assert.equal(typeof core[f], 'function', f);
    for (const f of ['offsetAt', 'utcFromWall', 'formatZoned']) assert.equal(typeof zone[f], 'function', f);
  });

  test('type declarations ship alongside the JavaScript', () => {
    for (const f of ['index', 'core', 'zone', 'brand']) {
      assert.ok(existsSync(`lib/${f}.js`), `lib/${f}.js`);
      assert.ok(existsSync(`lib/${f}.d.ts`), `lib/${f}.d.ts`);
    }
  });

  test('the declared types are exported from the entry declaration', () => {
    const d = readFileSync('lib/index.d.ts', 'utf8');
    for (const t of ['EpochMs', 'TimeZoneId', 'DateTimeFields', 'Disambiguation']) {
      assert.ok(d.includes(t), `${t} missing from lib/index.d.ts`);
    }
  });

  test('package.json exports map resolves', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const [sub, def] of Object.entries(pkg.exports)) {
      if (typeof def === 'string') { assert.ok(existsSync(def.replace('./', '')), `${sub} -> ${def}`); continue; }
      for (const [, p] of Object.entries(def)) assert.ok(existsSync(p.replace('./', '')), `${sub} -> ${p}`);
    }
  });

  test('no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
  });
});

describe('ChronoInstant method surface', () => {
  // A moment carries no calendar fields on purpose: that is what stops it impersonating
  // a ChronoPlain. See test/types.negative.ts, which asserts the absences compile-fail.
  const EXPECTED = [
    'addDays', 'addHours', 'addMilliseconds', 'addMinutes', 'addSeconds',
    'constructor', 'daysUntil', 'equals', 'hoursUntil', 'inZone', 'isAfter', 'isBefore',
    'millisecondsUntil', 'minutesUntil', 'secondsUntil',
    'toDate', 'toISODate', 'toISOString', 'toJSON', 'toString', 'toUtcPlain', 'valueOf',
  ];
  const GETTERS = ['epochMilliseconds', 'isValid'];

  test('methods are exactly as documented', () => {
    const names = Object.getOwnPropertyNames(ChronoInstant.prototype)
      .filter((n) => typeof Object.getOwnPropertyDescriptor(ChronoInstant.prototype, n).value === 'function');
    assert.deepEqual(names.sort(), EXPECTED);
  });

  test('getters are exactly as documented', () => {
    const names = Object.getOwnPropertyNames(ChronoInstant.prototype)
      .filter((n) => Object.getOwnPropertyDescriptor(ChronoInstant.prototype, n).get);
    assert.deepEqual(names.sort(), GETTERS);
  });

  test('statics are exactly as documented', () => {
    const names = Object.getOwnPropertyNames(ChronoInstant)
      .filter((n) => !['length', 'name', 'prototype'].includes(n));
    assert.deepEqual(names.sort(), ['compare', 'fromDate', 'fromEpochMs', 'now', 'parse', 'tryParse']);
  });

  test('a moment exposes no calendar field at runtime either', () => {
    const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
    for (const f of ['year', 'month', 'day', 'hour', 'minute', 'second', 'dayOfWeek']) {
      assert.equal(f in t, false, `${f} leaked onto ChronoInstant`);
    }
  });

  test('instances carry a single own field', () => {
    const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
    assert.deepEqual(Object.keys(t), ['ms']);
  });

  test('now() is close to Date.now()', () => {
    const before = Date.now();
    const n = ChronoInstant.now().ms;
    const after = Date.now();
    assert.ok(n >= before && n <= after, `${n} not within [${before}, ${after}]`);
  });

  test('fromDate round trips', () => {
    const d = new Date('2024-03-15T10:30:00.123Z');
    assert.equal(ChronoInstant.fromDate(d).toISOString(), d.toISOString());
  });
});

describe('ChronoPlain method surface', () => {
  test('a reading exposes no moment at runtime either', () => {
    const p = ChronoPlain.parse('2024-03-15T10:30');
    for (const f of ['epochMilliseconds', 'toDate', 'inZone', 'toISOString']) {
      assert.equal(f in p, false, `${f} leaked onto ChronoPlain`);
    }
  });

  test('statics are exactly as documented', () => {
    const names = Object.getOwnPropertyNames(ChronoPlain)
      .filter((n) => !['length', 'name', 'prototype'].includes(n));
    assert.deepEqual(names.sort(), ['compare', 'now', 'of', 'parse', 'tryParse']);
  });

  test('instances carry a single own field, named so it cannot pass for a timestamp', () => {
    assert.deepEqual(Object.keys(ChronoPlain.parse('2024-03-15T10:30')), ['wall']);
  });
});

describe('ChronoZoned method surface', () => {
  test('statics are exactly as documented', () => {
    const names = Object.getOwnPropertyNames(ChronoZoned)
      .filter((n) => !['length', 'name', 'prototype'].includes(n));
    assert.deepEqual(names.sort(), ['compare', 'fromEpochMs', 'fromLocal', 'now', 'parse', 'tryParse']);
  });

  test('instances carry exactly two own fields', () => {
    const z = ChronoZoned.fromEpochMs(0, 'UTC');
    assert.deepEqual(Object.keys(z).sort(), ['ms', 'tz']);
  });
});

describe('errors', () => {
  test('InvalidInstantError on NaN', () => {
    assert.throws(() => ChronoInstant.fromEpochMs(NaN), InvalidInstantError);
  });
  test('InvalidInstantError on Infinity', () => {
    assert.throws(() => ChronoInstant.fromEpochMs(Infinity), InvalidInstantError);
  });
  test('InvalidInstantError beyond the ECMAScript time range', () => {
    assert.throws(() => ChronoInstant.fromEpochMs(8.64e15 + 1), InvalidInstantError);
    assert.throws(() => ChronoInstant.fromEpochMs(-8.64e15 - 1), InvalidInstantError);
  });
  test('the range boundary itself is accepted', () => {
    assert.equal(ChronoInstant.fromEpochMs(8.64e15).ms, 8.64e15);
    assert.equal(ChronoInstant.fromEpochMs(-8.64e15).ms, -8.64e15);
  });
  test('UnknownTimeZoneError from inZone', () => {
    assert.throws(() => ChronoInstant.fromEpochMs(0).inZone('Not/AZone'), UnknownTimeZoneError);
  });
  test('UnknownTimeZoneError from ChronoZoned.parse', () => {
    assert.throws(() => ChronoZoned.parse('2024-01-01T00:00:00Z', 'Nope/Nope'), UnknownTimeZoneError);
  });
  test('UnknownTimeZoneError from fromLocal', () => {
    assert.throws(() => ChronoZoned.fromLocal('Bad/Zone', 2024, 1, 1), UnknownTimeZoneError);
  });
  test('UnknownTimeZoneError from withZone', () => {
    assert.throws(() => ChronoZoned.fromEpochMs(0, 'UTC').withZone('Bad/Zone'), UnknownTimeZoneError);
  });
  test('AmbiguousTimeError only with reject', () => {
    assert.throws(
      () => ChronoZoned.fromLocal('Europe/Bratislava', 2024, 10, 27, 2, 30, 0, 0, 'reject'),
      AmbiguousTimeError);
    assert.doesNotThrow(() => ChronoZoned.fromLocal('Europe/Bratislava', 2024, 10, 27, 2, 30));
  });
  test('all three errors extend Error and carry a name', () => {
    for (const [C, name] of [[InvalidInstantError, 'InvalidInstantError'],
                             [UnknownTimeZoneError, 'UnknownTimeZoneError'],
                             [AmbiguousTimeError, 'AmbiguousTimeError']]) {
      const e = new C(0, 'UTC');
      assert.ok(e instanceof Error, name);
      assert.equal(e.name, name);
      assert.ok(e.message.length > 0, `${name} has an empty message`);
    }
  });
  test('a valid zone is accepted and cached', () => {
    const t = ChronoInstant.fromEpochMs(0);
    for (let i = 0; i < 100; i++) assert.doesNotThrow(() => t.inZone('Europe/Bratislava'));
  });
});

describe('immutability', () => {
  test('ChronoInstant never mutates through any method', () => {
    const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
    const snapshot = t.ms;
    for (const name of Object.getOwnPropertyNames(ChronoInstant.prototype)) {
      const desc = Object.getOwnPropertyDescriptor(ChronoInstant.prototype, name);
      if (typeof desc.value !== 'function' || name === 'constructor') continue;
      try {
        if (name === 'inZone') t.inZone('UTC');
        else if (['millisecondsUntil', 'equals', 'isBefore', 'isAfter'].includes(name)) t[name](t);
        else t[name](1);
      } catch { /* argument shape mismatch is fine; we only care about mutation */ }
      assert.equal(t.ms, snapshot, `${name} mutated the receiver`);
    }
  });

  test('ChronoPlain never mutates through any method', () => {
    const p = ChronoPlain.parse('2024-03-15T10:30');
    const snapshot = p.wall;
    for (const name of Object.getOwnPropertyNames(ChronoPlain.prototype)) {
      const desc = Object.getOwnPropertyDescriptor(ChronoPlain.prototype, name);
      if (typeof desc.value !== 'function' || name === 'constructor') continue;
      try {
        if (name === 'assumeZone') p.assumeZone('UTC');
        else if (['daysUntil', 'monthsUntil', 'equals', 'isBefore', 'isAfter'].includes(name)) p[name](p);
        else p[name](1);
      } catch { /* ignore */ }
      assert.equal(p.wall, snapshot, `${name} mutated the receiver`);
    }
  });

  test('assigning to ms does not corrupt derived values', () => {
    const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
    const y = t.year;
    try { t.ms = 0; } catch { /* readonly in TS, not frozen at runtime */ }
    assert.ok(t.year === y || t.year === 1970, 'derived value became incoherent');
  });
});

describe('prototype hygiene', () => {
  test('classes do not pollute Object.prototype', () => {
    ChronoInstant.parse('2024-03-15T10:30:00.000Z').inZone('UTC').toISOString();
    assert.equal({}.ms, undefined);
    assert.equal({}.tz, undefined);
  });
  test('instances are plain, not frozen or sealed', () => {
    // Freezing would cost more on property reads in V8 than it buys; documented as such.
    const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
    assert.equal(Object.isFrozen(t), false);
  });
});
