// Locale formatting.
//
// Regression: none of the four classes defined `toLocaleString`, so the call resolved to
// `Object.prototype.toLocaleString`, which delegates to `toString()` and ignores both the
// locale and the options. Nothing threw. `typeof x.toLocaleString` was still `'function'`,
// so a probe checking for the method's presence reported parity. Every localised date in a
// UI would have rendered as an ISO string.
//
// The assertions below compare against Temporal rather than against fixed strings, because
// ICU output changes between runtimes and a hardcoded '2. 9. 2026' would rot.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Temporal } from 'temporal-polyfill';
import { ChronoInstant, ChronoPlain, ChronoZoned, ChronoDate } from '../lib/index.js';

const LOCALES = ['sk-SK', 'en-US', 'de-DE', 'ja-JP', 'fr-FR', 'en-GB', 'ar-EG'];
const TZ = 'Europe/Bratislava';
const WALL = '2026-09-02T14:30:00';
const INSTANT = '2026-09-02T12:30:00Z';

describe('the methods are defined, not inherited', () => {
  for (const [name, obj] of [
    ['ChronoInstant', ChronoInstant.parse(INSTANT)],
    ['ChronoPlain', ChronoPlain.parse(WALL)],
    ['ChronoZoned', ChronoInstant.parse(INSTANT).inZone(TZ)],
    ['ChronoDate', ChronoDate.parse('2026-09-02')],
  ]) {
    test(name, () => {
      const proto = Object.getPrototypeOf(obj);
      for (const m of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
        assert.ok(Object.getOwnPropertyNames(proto).includes(m),
          `${m} must be defined on ${name}, not inherited from Object.prototype`);
      }
      // The tell-tale of the old bug: output identical to toString().
      assert.notEqual(obj.toLocaleString('sk-SK'), obj.toString(),
        'a localised string must not be the ISO string');
    });
  }
});

describe('ChronoPlain matches Temporal.PlainDateTime', () => {
  const p = ChronoPlain.parse(WALL);
  const t = Temporal.PlainDateTime.from(WALL);
  for (const loc of LOCALES) {
    test(loc, () => assert.equal(p.toLocaleString(loc), t.toLocaleString(loc)));
  }
  const OPTS = [
    { month: 'long', day: 'numeric', year: 'numeric' },
    { weekday: 'long' }, { dateStyle: 'full' },
    { dateStyle: 'short', timeStyle: 'short' },
    { era: 'short' }, { hour: '2-digit', minute: '2-digit' },
  ];
  for (const o of OPTS) {
    test(JSON.stringify(o), () =>
      assert.equal(p.toLocaleString('sk-SK', o), t.toLocaleString('sk-SK', o)));
  }
  test('a timeZone option is ignored, because a reading has no moment to shift', () => {
    assert.equal(p.toLocaleString('sk-SK', { timeZone: 'Asia/Tokyo' }),
                 t.toLocaleString('sk-SK', { timeZone: 'Asia/Tokyo' }));
    assert.equal(p.toLocaleString('sk-SK', { timeZone: 'Asia/Tokyo' }), p.toLocaleString('sk-SK'));
  });
});

describe('ChronoDate matches Temporal.PlainDate, and prints no time', () => {
  const d = ChronoDate.parse('2026-09-02');
  const t = Temporal.PlainDate.from('2026-09-02');
  for (const loc of LOCALES) {
    test(loc, () => {
      assert.equal(d.toLocaleString(loc), t.toLocaleString(loc));
      assert.equal(/\d:\d\d/.test(d.toLocaleString(loc)), false, 'a date must not print a clock');
    });
  }
  test('explicit options still work', () => {
    const o = { month: 'long', day: 'numeric', year: 'numeric' };
    assert.equal(d.toLocaleString('sk-SK', o), t.toLocaleString('sk-SK', o));
    assert.equal(d.toLocaleString('sk-SK', { dateStyle: 'full' }),
                 t.toLocaleString('sk-SK', { dateStyle: 'full' }));
  });
});

describe('ChronoZoned matches Temporal.ZonedDateTime, and names its zone', () => {
  const z = ChronoInstant.parse(INSTANT).inZone(TZ);
  const t = Temporal.Instant.from(INSTANT).toZonedDateTimeISO(TZ);
  for (const loc of LOCALES) {
    test(loc, () => assert.equal(z.toLocaleString(loc), t.toLocaleString(loc)));
  }
  for (const o of [{ timeZoneName: 'short' }, { timeZoneName: 'long' },
                   { dateStyle: 'full', timeStyle: 'long' },
                   { hour: '2-digit', minute: '2-digit' }]) {
    test(JSON.stringify(o), () =>
      assert.equal(z.toLocaleString('sk-SK', o), t.toLocaleString('sk-SK', o)));
  }
  test('the zone is named by default, which is how you tell it from a ChronoPlain', () => {
    assert.notEqual(z.toLocaleString('sk-SK'), ChronoPlain.parse(WALL).toLocaleString('sk-SK'));
  });
});

describe('ChronoInstant matches Temporal.Instant, rendering in the host zone', () => {
  const i = ChronoInstant.parse(INSTANT);
  const t = Temporal.Instant.from(INSTANT);
  for (const loc of LOCALES) {
    test(loc, () => assert.equal(i.toLocaleString(loc), t.toLocaleString(loc)));
  }
  test('inZone picks the zone explicitly', () => {
    assert.equal(i.inZone('Asia/Tokyo').toLocaleString('sk-SK'),
                 Temporal.Instant.from(INSTANT).toZonedDateTimeISO('Asia/Tokyo').toLocaleString('sk-SK'));
  });
});

describe('date-only and time-only variants match native Date', () => {
  const wall = Date.UTC(2026, 8, 2, 14, 30, 0);
  const p = ChronoPlain.parse(WALL);
  for (const loc of LOCALES) {
    test(loc, () => {
      assert.equal(p.toLocaleDateString(loc), new Date(wall).toLocaleDateString(loc, { timeZone: 'UTC' }));
      assert.equal(p.toLocaleTimeString(loc), new Date(wall).toLocaleTimeString(loc, { timeZone: 'UTC' }));
    });
  }
});

describe('edge cases', () => {
  test('an invalid value yields Invalid Date rather than throwing in a render', () => {
    for (const bad of [new ChronoPlain(NaN), new ChronoDate(NaN),
                       new ChronoInstant(NaN), new ChronoZoned(NaN, TZ)]) {
      assert.equal(bad.toLocaleString('sk-SK'), 'Invalid Date');
      assert.equal(bad.toLocaleDateString('sk-SK'), 'Invalid Date');
      assert.equal(bad.toLocaleTimeString('sk-SK'), 'Invalid Date');
    }
  });

  test('no locale argument uses the host default, like Date', () => {
    const wall = Date.UTC(2026, 8, 2, 14, 30, 0);
    assert.equal(ChronoPlain.parse(WALL).toLocaleString(),
                 new Date(wall).toLocaleString(undefined, { timeZone: 'UTC' }));
  });

  test('an array of locales is accepted', () => {
    assert.equal(ChronoPlain.parse(WALL).toLocaleString(['xx-INVALID', 'sk-SK']),
                 ChronoPlain.parse(WALL).toLocaleString('sk-SK'));
  });

  test('the formatter cache does not change the answer', () => {
    const p = ChronoPlain.parse(WALL);
    const first = p.toLocaleString('sk-SK', { dateStyle: 'full' });
    for (let i = 0; i < 500; i++) p.toLocaleString('sk-SK', { dateStyle: 'full' });
    assert.equal(p.toLocaleString('sk-SK', { dateStyle: 'full' }), first);
  });

  test('the cache stays bounded under adversarial option churn', async () => {
    const { localeFormatterCount } = await import('../lib/zone.js');
    const p = ChronoPlain.parse(WALL);
    for (let i = 0; i < 2000; i++) p.toLocaleString('sk-SK', { fractionalSecondDigits: (i % 3) + 1, era: i % 2 ? 'short' : 'long' });
    assert.ok(localeFormatterCount() <= 256, `cache grew to ${localeFormatterCount()}`);
  });

  test('dates across a DST boundary render with the right zone name', () => {
    const summer = ChronoInstant.parse('2026-07-01T12:00:00Z').inZone(TZ);
    const winter = ChronoInstant.parse('2026-01-01T12:00:00Z').inZone(TZ);
    assert.notEqual(summer.toLocaleString('en-GB', { timeZoneName: 'short' }),
                    winter.toLocaleString('en-GB', { timeZoneName: 'short' }));
    assert.equal(summer.toLocaleString('en-GB', { timeZoneName: 'short' }),
                 Temporal.Instant.from('2026-07-01T12:00:00Z').toZonedDateTimeISO(TZ)
                   .toLocaleString('en-GB', { timeZoneName: 'short' }));
  });
});
