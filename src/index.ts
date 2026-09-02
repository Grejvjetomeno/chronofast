// chronofast - public surface.
//
// Three types, and the discipline is that **each one is missing what the others have**.
// That is not stylistic: an earlier version of this library had a single class carrying
// both calendar fields and epoch milliseconds, and it could silently impersonate either
// role. Sorting a mixed array misordered it, and `.inZone()` on a wall-clock value applied
// the offset twice. Neither mistake was catchable by the compiler.
//
//   ChronoInstant   a moment. Has epochMilliseconds. Has NO calendar fields.
//   ChronoPlain     a clock reading. Has calendar fields. Has NO epochMilliseconds.
//   ChronoZoned     both, legitimately - a zone is exactly what turns one into the other.
//
// This mirrors how Temporal separates Instant / PlainDateTime / ZonedDateTime, and for the
// same reason: capabilities are removed rather than merely documented.

export type { EpochMs, WallMs, TimeZoneId } from './brand.js';
export { InvalidInstantError, UnknownTimeZoneError } from './brand.js';
export type { DateTimeFields } from './core.js';
export type { Disambiguation } from './zone.js';
export { AmbiguousTimeError } from './zone.js';

import type { EpochMs, WallMs, TimeZoneId } from './brand.js';
import {
  unsafeEpochMs, unsafeWallMs, epochMs as checkedEpochMs, timeZone as checkedZone,
} from './brand.js';
import {
  parseISO, hasZoneDesignator, toISO, toISODate, unpack, readFields,
  pad2, pad3, pad4, daysFromCivil, MS_DAY,
  addMonths as addMonthsRaw, addYears as addYearsRaw,
  startOfDay as startOfDayRaw, startOfHour as startOfHourRaw,
  startOfMinute as startOfMinuteRaw, startOfMonth as startOfMonthRaw,
  startOfYear as startOfYearRaw, startOfWeek as startOfWeekRaw,
  diffDays as diffDaysRaw, diffMonths as diffMonthsRaw,
  dayOfWeek as isoDayOfWeekRaw, isoWeek, isoWeekYear, dayOfYear as dayOfYearRaw,
  getYear, getMonth, getDay, getHour, getMinute, getSecond, getMillisecond,
  type DateTimeFields,
} from './core.js';
import {
  offsetAt, utcFromWall, formatZoned, toZonedISODate, startOfDayZoned,
  addDaysZoned, addMonthsZoned, zonedFields, type Disambiguation,
} from './zone.js';
import { cY, cM, cD, cH, cMi, cS, cMs } from './core.js';

// Module-local unit constants. Reading these through a cross-module import binding costs
// measurably more on one-line methods than a local const does.
const SEC = 1000, MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

// ============================================================ ChronoInstant

/**
 * A moment on the UTC timeline, to millisecond precision. **Immutable.**
 *
 * Deliberately has **no calendar fields**. A moment is not a year and a month until you
 * say which clock is reading it, so ask for one: {@link inZone} attaches a zone, and
 * {@link toUtcPlain} gives the UTC reading explicitly.
 *
 * @example
 * const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
 * t.epochMilliseconds
 * t.addHours(3).toISOString()
 * t.inZone('Europe/Bratislava').hour      // 11 - a reading, through a zone
 * t.toUtcPlain().hour                     // 10 - the UTC reading, asked for by name
 */
export class ChronoInstant {
  /**
   * Epoch milliseconds. Branded, so a plain `number` will not type-check here and a
   * {@link WallMs} from {@link ChronoPlain} will not either.
   */
  readonly ms: EpochMs;

  /**
   * Wraps an already-validated instant. Performs **no** checking - the branded parameter
   * type is the guard. For untrusted input use {@link ChronoInstant.fromEpochMs}.
   */
  constructor(ms: EpochMs) {
    this.ms = ms;
  }

  /**
   * Parse an ISO-8601 string as a moment. A missing designator reads as **UTC**.
   *
   * If the string is a local reading rather than a moment, use {@link ChronoPlain.parse}
   * or {@link ChronoZoned.parse}, which do not assume UTC.
   *
   * Returns an instance whose `isValid` is `false` on malformed input; it does not throw.
   */
  static parse(s: string): ChronoInstant { return new ChronoInstant(parseISO(s)); }

  /** Validates. Throws `InvalidInstantError` on NaN, Infinity, or out-of-range input. */
  static fromEpochMs(ms: number): ChronoInstant { return new ChronoInstant(checkedEpochMs(ms)); }

  /** The current moment. See also {@link Now}, which makes the choice of clock explicit. */
  static now(): ChronoInstant { return new ChronoInstant(unsafeEpochMs(Date.now())); }

  /** Convert from a native `Date`. The moment is preserved exactly. */
  static fromDate(d: Date): ChronoInstant { return new ChronoInstant(unsafeEpochMs(d.getTime())); }

  /** Comparator for `Array#sort`, earliest first. Only accepts moments. */
  static compare(a: ChronoInstant, b: ChronoInstant): -1 | 0 | 1 {
    return a.ms < b.ms ? -1 : a.ms > b.ms ? 1 : 0;
  }

  /** Milliseconds since 1970-01-01T00:00:00Z. */
  get epochMilliseconds(): number { return this.ms; }

  /** `false` if this came from parsing malformed input. */
  get isValid(): boolean { return !Number.isNaN(this.ms); }

  // ---- exact-time arithmetic; a calendar is not involved, so no zone is needed ----

  /** Exact-time addition. `n` may be negative. */
  addMilliseconds(n: number): ChronoInstant { return new ChronoInstant((this.ms + n) as EpochMs); }
  /** Add `n` seconds of elapsed time. */
  addSeconds(n: number): ChronoInstant { return new ChronoInstant((this.ms + n * SEC) as EpochMs); }
  /** Add `n` minutes of elapsed time. */
  addMinutes(n: number): ChronoInstant { return new ChronoInstant((this.ms + n * MIN) as EpochMs); }
  /** Add `n` hours of elapsed time. */
  addHours(n: number): ChronoInstant { return new ChronoInstant((this.ms + n * HOUR) as EpochMs); }
  /**
   * Add `n` spans of exactly 24 hours.
   *
   * Named `addDays` because on the UTC timeline a day is always 24 hours. It is **not** a
   * calendar day in a zone - for that, go through {@link inZone} first, where a day may be
   * 23 or 25 hours.
   */
  addDays(n: number): ChronoInstant { return new ChronoInstant((this.ms + n * DAY) as EpochMs); }

  /**
   * Elapsed milliseconds from this moment to `other`. Negative if `other` is earlier.
   *
   * TypeScript rejects `b - a` on objects, so the difference is a method. `<`, `>`, `<=`
   * and `>=` do work between two moments, via {@link valueOf}.
   */
  millisecondsUntil(other: ChronoInstant): number { return other.ms - this.ms; }
  /** Elapsed whole seconds to `other`, truncated toward zero. */
  secondsUntil(other: ChronoInstant): number { return ((other.ms - this.ms) / SEC) | 0; }
  /** Elapsed whole minutes to `other`, truncated toward zero. */
  minutesUntil(other: ChronoInstant): number { return ((other.ms - this.ms) / MIN) | 0; }
  /** Elapsed whole hours to `other`, truncated toward zero. */
  hoursUntil(other: ChronoInstant): number { return ((other.ms - this.ms) / HOUR) | 0; }
  /** Elapsed whole 24-hour spans to `other`, truncated toward zero. */
  daysUntil(other: ChronoInstant): number { return ((other.ms - this.ms) / DAY) | 0; }

  /** Same moment, to the millisecond. */
  equals(other: ChronoInstant): boolean { return this.ms === other.ms; }
  /** Strictly earlier than `other`. */
  isBefore(other: ChronoInstant): boolean { return this.ms < other.ms; }
  /** Strictly later than `other`. */
  isAfter(other: ChronoInstant): boolean { return this.ms > other.ms; }

  // ---- conversions: every route to calendar fields is named ----

  /** Same moment, read through `tz`. Throws `UnknownTimeZoneError` on a bad zone id. */
  inZone(tz: TimeZoneId | string): ChronoZoned { return new ChronoZoned(this.ms, checkedZone(tz)); }

  /**
   * The **UTC** reading of this moment, as a zone-free value.
   *
   * Spelled out rather than implicit: `instant.hour` does not exist precisely so that
   * reading UTC fields is a decision you can see in the code.
   */
  toUtcPlain(): ChronoPlain { return new ChronoPlain(unsafeWallMs(this.ms)); }

  /** Convert to a native `Date`. The moment is preserved exactly. */
  toDate(): Date { return new Date(this.ms); }

  /** `YYYY-MM-DDTHH:mm:ss.sssZ` - byte-identical to `Date#toISOString()`. */
  toISOString(): string { return toISO(this.ms); }
  /** `YYYY-MM-DD` in UTC. */
  toISODate(): string { return toISODate(this.ms); }
  /** Same as {@link toISOString}. */
  toString(): string { return toISO(this.ms); }
  /** Serialises to ISO-8601, so `JSON.stringify` round-trips through {@link parse}. */
  toJSON(): string { return toISO(this.ms); }
  /** The epoch milliseconds, so `<`, `>` and `-` work between moments. */
  valueOf(): number { return this.ms; }
}

// ============================================================ ChronoPlain

/**
 * A clock reading with no zone and therefore **no moment**: `2024-03-15T10:30` is a year,
 * a month, a day and a time, and nothing more. **Immutable.**
 *
 * Deliberately has **no `epochMilliseconds` and no `toDate()`**. Until a zone says which
 * 10:30 is meant, there is no instant to hand out. {@link assumeZone} is the way across.
 *
 * This is the type for values that arrive without a zone - a date picker, a CSV column,
 * a legacy database field - and for `Temporal.PlainDateTime`.
 *
 * @example
 * const p = ChronoPlain.parse('2024-03-15T10:30');
 * p.hour                                  // 10
 * p.addDays(7).toPlainISOString()         // '2024-03-22T10:30:00'
 * p.assumeZone('Europe/Bratislava')       // now it is a moment
 */
export class ChronoPlain {
  /**
   * The reading, encoded as milliseconds **as if it were UTC**.
   *
   * Branded {@link WallMs} rather than {@link EpochMs} on purpose: the compiler will not
   * let this be used where a moment is expected, because it is not one.
   */
  readonly wall: WallMs;

  /** Wraps an already-validated reading. Performs no checking. */
  constructor(wall: WallMs) {
    this.wall = wall;
  }

  /**
   * Parse an ISO-8601 string as a clock reading. Any `Z` or offset in the string is
   * **ignored** - a reading has no offset. Use {@link ChronoInstant.parse} if you meant a
   * moment, or {@link ChronoZoned.parse} to resolve one against a zone.
   */
  static parse(s: string): ChronoPlain { return new ChronoPlain(unsafeWallMs(parseISO(s))); }

  /**
   * Build from calendar fields.
   * @param mo Month, **1-12**. January is 1.
   */
  static of(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): ChronoPlain {
    return new ChronoPlain(unsafeWallMs(
      daysFromCivil(y, mo, d) * MS_DAY + h * HOUR + mi * MIN + s * SEC + ms));
  }

  /** The current reading in `tz` - the system zone by default. */
  static now(tz?: TimeZoneId | string): ChronoPlain { return Now.plainDateTimeISO(tz); }

  /** Comparator for `Array#sort`, earliest reading first. Only accepts readings. */
  static compare(a: ChronoPlain, b: ChronoPlain): -1 | 0 | 1 {
    return a.wall < b.wall ? -1 : a.wall > b.wall ? 1 : 0;
  }

  /** `false` if this came from parsing malformed input. */
  get isValid(): boolean { return !Number.isNaN(this.wall); }

  /** Calendar year. */
  get year(): number { return getYear(this.wall as unknown as EpochMs); }
  /** Month, **1-12**. January is `1`, not `0`. */
  get month(): number { return getMonth(this.wall as unknown as EpochMs); }
  /** Day of the month, **1-31**. */
  get day(): number { return getDay(this.wall as unknown as EpochMs); }
  /** Hour, **0-23**. */
  get hour(): number { return getHour(this.wall as unknown as EpochMs); }
  /** Minute, **0-59**. */
  get minute(): number { return getMinute(this.wall as unknown as EpochMs); }
  /** Second, **0-59**. */
  get second(): number { return getSecond(this.wall as unknown as EpochMs); }
  /** Millisecond, **0-999**. */
  get millisecond(): number { return getMillisecond(this.wall as unknown as EpochMs); }
  /** ISO day of week, **1 = Monday … 7 = Sunday**. */
  get dayOfWeek(): number { return isoDayOfWeekRaw(this.wall as unknown as EpochMs); }
  /** Day of the year, **1-366**. */
  get dayOfYear(): number { return dayOfYearRaw(this.wall as unknown as EpochMs); }
  /** ISO-8601 week number, **1-53**. */
  get weekOfYear(): number { return isoWeek(this.wall as unknown as EpochMs); }
  /** ISO week-numbering year, which can differ from {@link year} at a year boundary. */
  get weekYear(): number { return isoWeekYear(this.wall as unknown as EpochMs); }

  /** All seven fields from a single civil conversion. */
  fields(): DateTimeFields { unpack(this.wall); return readFields(); }

  // ---- calendar arithmetic; no zone is involved, so no DST is involved either ----

  /** Add `n` milliseconds to the reading. */
  addMilliseconds(n: number): ChronoPlain { return new ChronoPlain((this.wall + n) as WallMs); }
  /** Add `n` seconds to the reading. */
  addSeconds(n: number): ChronoPlain { return new ChronoPlain((this.wall + n * SEC) as WallMs); }
  /** Add `n` minutes to the reading. */
  addMinutes(n: number): ChronoPlain { return new ChronoPlain((this.wall + n * MIN) as WallMs); }
  /** Add `n` hours to the reading. */
  addHours(n: number): ChronoPlain { return new ChronoPlain((this.wall + n * HOUR) as WallMs); }
  /** Add `n` days to the reading. Always exactly 24 hours - a reading has no DST. */
  addDays(n: number): ChronoPlain { return new ChronoPlain((this.wall + n * DAY) as WallMs); }
  /** Add `n * 7` days to the reading. */
  addWeeks(n: number): ChronoPlain { return new ChronoPlain((this.wall + n * 7 * DAY) as WallMs); }
  /**
   * Add `n` calendar months, **clamping to the end of the target month**.
   * @example ChronoPlain.parse('2024-01-31').addMonths(1).toISODate()   // '2024-02-29'
   */
  addMonths(n: number): ChronoPlain {
    return new ChronoPlain(unsafeWallMs(addMonthsRaw(this.wall as unknown as EpochMs, n)));
  }
  /** Add `n * 12` months, clamping. */
  addYears(n: number): ChronoPlain {
    return new ChronoPlain(unsafeWallMs(addYearsRaw(this.wall as unknown as EpochMs, n)));
  }

  /** Truncate to the start of this minute. */
  startOfMinute(): ChronoPlain { return new ChronoPlain(unsafeWallMs(startOfMinuteRaw(this.wall as unknown as EpochMs))); }
  /** Truncate to the top of this hour. */
  startOfHour(): ChronoPlain { return new ChronoPlain(unsafeWallMs(startOfHourRaw(this.wall as unknown as EpochMs))); }
  /** Midnight of this day. */
  startOfDay(): ChronoPlain { return new ChronoPlain(unsafeWallMs(startOfDayRaw(this.wall as unknown as EpochMs))); }
  /**
   * Midnight on the first day of this week.
   * @param firstDay `0` = Sunday … `6` = Saturday. Defaults to `1`, Monday (ISO).
   */
  startOfWeek(firstDay?: number): ChronoPlain {
    return new ChronoPlain(unsafeWallMs(startOfWeekRaw(this.wall as unknown as EpochMs, firstDay)));
  }
  /** Midnight on the first day of this month. */
  startOfMonth(): ChronoPlain { return new ChronoPlain(unsafeWallMs(startOfMonthRaw(this.wall as unknown as EpochMs))); }
  /** Midnight on 1 January of this year. */
  startOfYear(): ChronoPlain { return new ChronoPlain(unsafeWallMs(startOfYearRaw(this.wall as unknown as EpochMs))); }

  /** Whole calendar days from this reading to `other`. */
  daysUntil(other: ChronoPlain): number {
    return diffDaysRaw(this.wall as unknown as EpochMs, other.wall as unknown as EpochMs);
  }
  /** Whole calendar months from this reading to `other`, truncated toward zero. */
  monthsUntil(other: ChronoPlain): number {
    return diffMonthsRaw(this.wall as unknown as EpochMs, other.wall as unknown as EpochMs);
  }

  /** Elapsed milliseconds between the two readings. Negative if `other` is earlier. */
  millisecondsUntil(other: ChronoPlain): number { return other.wall - this.wall; }
  /** Whole minutes between the two readings, truncated toward zero. */
  minutesUntil(other: ChronoPlain): number { return ((other.wall - this.wall) / MIN) | 0; }
  /** Whole hours between the two readings, truncated toward zero. */
  hoursUntil(other: ChronoPlain): number { return ((other.wall - this.wall) / HOUR) | 0; }

  /**
   * The underlying reading, so `<`, `>`, `<=` and `>=` order two readings correctly.
   *
   * Without this, JavaScript falls back to comparing the ISO strings, which is subtly
   * wrong: `'+010000-01-01'` sorts before `'2024-03-15'` because `'+'` precedes `'2'`.
   *
   * TypeScript still refuses to compare a `ChronoPlain` with a `ChronoInstant` - the
   * operator rejects mixed operand types - so this does not reopen that confusion.
   */
  valueOf(): number { return this.wall; }

  /** Same reading, to the millisecond. */
  equals(other: ChronoPlain): boolean { return this.wall === other.wall; }
  /** Strictly earlier reading than `other`. */
  isBefore(other: ChronoPlain): boolean { return this.wall < other.wall; }
  /** Strictly later reading than `other`. */
  isAfter(other: ChronoPlain): boolean { return this.wall > other.wall; }

  // ---- the only route to a moment ----

  /**
   * Declare which zone this reading was taken in, producing a real moment.
   *
   * Named `assumeZone` because that is what it does: you are asserting knowledge the value
   * did not carry. The offset is resolved for this date, so DST is handled rather than
   * assumed.
   *
   * @param disambiguation What to do on the two days a year when the reading is ambiguous
   *                       or does not exist. Defaults to Temporal's `'compatible'`.
   */
  assumeZone(tz: TimeZoneId | string, disambiguation: Disambiguation = 'compatible'): ChronoZoned {
    const zoneId = checkedZone(tz);
    return new ChronoZoned(utcFromWall(zoneId, this.wall, disambiguation), zoneId);
  }

  /**
   * `YYYY-MM-DDTHH:mm:ss` with no `Z` and no trailing zeros in the fraction - the same text
   * `Temporal.PlainDateTime#toString()` produces.
   */
  toPlainISOString(): string {
    unpack(this.wall);
    let frac = '';
    if (cMs !== 0) {
      const d3 = pad3(cMs);
      frac = '.' + (d3.charCodeAt(2) !== 48 ? d3 : d3.charCodeAt(1) !== 48 ? d3.slice(0, 2) : d3.slice(0, 1));
    }
    return pad4(cY) + '-' + pad2(cM) + '-' + pad2(cD) + 'T' +
           pad2(cH) + ':' + pad2(cMi) + ':' + pad2(cS) + frac;
  }

  /** `YYYY-MM-DD`. Identical to `Temporal.PlainDate#toString()`. */
  toISODate(): string { return toISODate(this.wall as unknown as EpochMs); }
  /** Same as {@link toPlainISOString}. */
  toString(): string { return this.toPlainISOString(); }
  /** Serialises without a `Z`, because the reading carries no offset to claim. */
  toJSON(): string { return this.toPlainISOString(); }
}

// ============================================================ ChronoZoned

/**
 * A moment, read through an IANA zone. **Immutable.**
 *
 * The only type that legitimately has both an instant and calendar fields, because a zone
 * is exactly what connects them.
 */
export class ChronoZoned {
  /** Epoch milliseconds - the moment itself, independent of {@link tz}. */
  readonly ms: EpochMs;
  /** The IANA zone id this moment is read through, e.g. `'Europe/Bratislava'`. */
  readonly tz: TimeZoneId | string;

  /** Wraps an already-validated moment and zone. Performs no checking. */
  constructor(ms: EpochMs, tz: TimeZoneId | string) {
    this.ms = ms;
    this.tz = tz;
  }

  /**
   * Parse a string as a moment in `tz`, deciding by whether it carries a designator:
   *
   * - `'2000-09-01T10:00:00Z'` or `'...+05:00'` - an exact moment, displayed in `tz`.
   * - `'2000-09-01T10:00'` or `'2000-09-01'` - a **reading in `tz`**, resolved using that
   *   date's offset. So this round-trips as 10:00, not 12:00.
   */
  static parse(
    s: string,
    tz: TimeZoneId | string,
    disambiguation: Disambiguation = 'compatible',
  ): ChronoZoned {
    const zoneId = checkedZone(tz);
    const ms = parseISO(s);
    if (Number.isNaN(ms) || hasZoneDesignator(s)) return new ChronoZoned(ms, zoneId);
    return new ChronoZoned(utcFromWall(zoneId, unsafeWallMs(ms), disambiguation), zoneId);
  }

  /** An exact moment, read through `tz`. Validates both arguments. */
  static fromEpochMs(ms: number, tz: TimeZoneId | string): ChronoZoned {
    return new ChronoZoned(checkedEpochMs(ms), checkedZone(tz));
  }

  /**
   * Interpret local wall-clock fields in `tz`.
   * @param mo Month, **1-12**.
   */
  static fromLocal(
    tz: TimeZoneId | string,
    y: number, mo: number, d: number,
    h = 0, mi = 0, s = 0, msec = 0,
    disambiguation: Disambiguation = 'compatible',
  ): ChronoZoned {
    return ChronoPlain.of(y, mo, d, h, mi, s, msec).assumeZone(tz, disambiguation);
  }

  /** The current moment in `tz` - the system zone by default. */
  static now(tz?: TimeZoneId | string): ChronoZoned { return Now.zonedDateTimeISO(tz); }

  /** Comparator for `Array#sort`, earliest first. Zones may differ; the moment is compared. */
  static compare(a: ChronoZoned, b: ChronoZoned): -1 | 0 | 1 {
    return a.ms < b.ms ? -1 : a.ms > b.ms ? 1 : 0;
  }

  /** Milliseconds since the epoch. Independent of the zone. */
  get epochMilliseconds(): number { return this.ms; }
  /** `false` if this came from parsing malformed input. */
  get isValid(): boolean { return !Number.isNaN(this.ms); }
  /** UTC offset in **milliseconds** at this moment, e.g. `7200000` for +02:00. */
  get offset(): number { return offsetAt(this.tz, this.ms); }
  /** UTC offset in hours, fractional for zones like `+05:45`. */
  get offsetHours(): number { return offsetAt(this.tz, this.ms) / HOUR; }

  /** Local calendar year in this zone. */
  get year(): number { zonedFields(this.tz, this.ms); return cY; }
  /** Local month, **1-12**. January is `1`. */
  get month(): number { zonedFields(this.tz, this.ms); return cM; }
  /** Local day of the month, **1-31**. */
  get day(): number { zonedFields(this.tz, this.ms); return cD; }
  /** Local hour, **0-23**. */
  get hour(): number { zonedFields(this.tz, this.ms); return cH; }
  /** Local minute, **0-59**. */
  get minute(): number { zonedFields(this.tz, this.ms); return cMi; }
  /** Local second, **0-59**. */
  get second(): number { zonedFields(this.tz, this.ms); return cS; }
  /** Millisecond, **0-999**. Identical in every zone; offsets are whole seconds. */
  get millisecond(): number { zonedFields(this.tz, this.ms); return cMs; }
  /** Local ISO day of week, **1 = Monday … 7 = Sunday**. */
  get dayOfWeek(): number { return this.toPlain().dayOfWeek; }
  /** Local day of the year, **1-366**. */
  get dayOfYear(): number { return this.toPlain().dayOfYear; }
  /** Local ISO-8601 week number, **1-53**. */
  get weekOfYear(): number { return this.toPlain().weekOfYear; }
  /** Local ISO week-numbering year. */
  get weekYear(): number { return this.toPlain().weekYear; }

  /** All seven local fields from a single zone lookup and one civil conversion. */
  fields(): DateTimeFields { zonedFields(this.tz, this.ms); return readFields(); }

  /** Exactly `n` hours of elapsed time. Unaffected by DST. */
  addHours(n: number): ChronoZoned { return new ChronoZoned((this.ms + n * HOUR) as EpochMs, this.tz); }
  /** Exactly `n` minutes of elapsed time. Unaffected by DST. */
  addMinutes(n: number): ChronoZoned { return new ChronoZoned((this.ms + n * MIN) as EpochMs, this.tz); }
  /** Exactly `n` seconds of elapsed time. Unaffected by DST. */
  addSeconds(n: number): ChronoZoned { return new ChronoZoned((this.ms + n * SEC) as EpochMs, this.tz); }

  /**
   * Adds `n` **calendar** days: the same wall-clock time on a later date. Across a DST
   * boundary this moves 23 or 25 hours, not 24. For exactly 24 hours use `addHours(24)`.
   */
  addDays(n: number): ChronoZoned { return new ChronoZoned(addDaysZoned(this.tz, this.ms, n), this.tz); }
  /** Adds `n` calendar months in local time, clamping to the end of the target month. */
  addMonths(n: number): ChronoZoned { return new ChronoZoned(addMonthsZoned(this.tz, this.ms, n), this.tz); }
  /** Adds `n * 12` calendar months in local time, clamping. */
  addYears(n: number): ChronoZoned { return new ChronoZoned(addMonthsZoned(this.tz, this.ms, n * 12), this.tz); }

  /** Local midnight of this day. Correct when local midnight does not exist. */
  startOfDay(): ChronoZoned { return new ChronoZoned(startOfDayZoned(this.tz, this.ms), this.tz); }

  /** Elapsed milliseconds from this moment to `other`. Zones may differ. */
  millisecondsUntil(other: ChronoZoned): number { return other.ms - this.ms; }
  /** Elapsed whole minutes to `other`, truncated toward zero. */
  minutesUntil(other: ChronoZoned): number { return ((other.ms - this.ms) / MIN) | 0; }
  /** Elapsed whole hours to `other`, truncated toward zero. */
  hoursUntil(other: ChronoZoned): number { return ((other.ms - this.ms) / HOUR) | 0; }
  /**
   * Whole **calendar** days between the local readings, not 24-hour spans - so a day that
   * crosses a DST boundary still counts as one.
   */
  daysUntil(other: ChronoZoned): number { return this.toPlain().daysUntil(other.toPlain()); }
  /** Whole calendar months between the local readings, truncated toward zero. */
  monthsUntil(other: ChronoZoned): number { return this.toPlain().monthsUntil(other.toPlain()); }

  /** Same moment, to the millisecond. Zones may differ. */
  equals(other: ChronoZoned): boolean { return this.ms === other.ms; }
  /** Strictly earlier than `other`. */
  isBefore(other: ChronoZoned): boolean { return this.ms < other.ms; }
  /** Strictly later than `other`. */
  isAfter(other: ChronoZoned): boolean { return this.ms > other.ms; }

  /** Same moment, read through another zone. The moment is unchanged. */
  withZone(tz: TimeZoneId | string): ChronoZoned { return new ChronoZoned(this.ms, checkedZone(tz)); }

  /**
   * Same wall-clock reading, in another zone. The reading is unchanged; the moment moves.
   * 09:00 in London becomes 09:00 in New York, five hours later.
   */
  withZoneSameLocal(tz: TimeZoneId | string, disambiguation: Disambiguation = 'compatible'): ChronoZoned {
    return this.toPlain().assumeZone(tz, disambiguation);
  }

  /** The moment, without the zone. */
  toInstant(): ChronoInstant { return new ChronoInstant(this.ms); }
  /** The local reading, without the zone - and therefore without a moment. */
  toPlain(): ChronoPlain { return new ChronoPlain(unsafeWallMs(this.ms + offsetAt(this.tz, this.ms))); }
  /** Convert to a native `Date`. The moment is preserved; the zone is lost. */
  toDate(): Date { return new Date(this.ms); }

  /** Local ISO-8601 with offset, e.g. `2024-03-15T11:30:00.123+01:00`. No zone id. */
  toISOString(): string { return formatZoned(this.tz, this.ms); }
  /** Local `YYYY-MM-DD`, which can differ from the UTC date. */
  toISODate(): string { return toZonedISODate(this.tz, this.ms); }
  /** Local ISO with the zone id appended, e.g. `...+01:00[Europe/Bratislava]`. */
  toString(): string { return formatZoned(this.tz, this.ms) + '[' + this.tz + ']'; }
  /** Serialises with its offset but without the zone id. Store `tz` separately if needed. */
  toJSON(): string { return formatZoned(this.tz, this.ms); }
  /** The epoch milliseconds, so `<`, `>` and `-` compare moments across zones. */
  valueOf(): number { return this.ms; }
}

// ============================================================ Now

let systemZone: string | null = null;

/**
 * Reading the current time, with the ambiguity made explicit.
 *
 * "Now" is not one value. At 09:07 in Bratislava the moment and the local reading are two
 * different things, and picking the wrong one used to be silent. Each method here returns
 * a **different type**, so the choice is visible in the code and enforced by the compiler.
 *
 * The names mirror `Temporal.Now`, so migrating is a rename of `Temporal.Now.x()` to
 * `Now.x()`.
 *
 * @example
 * // the local clock says 09:07
 * Now.instant()             // ChronoInstant - a moment; no .hour to misread
 * Now.plainDateTimeISO()    // ChronoPlain   - .hour is 9
 * Now.zonedDateTimeISO()    // ChronoZoned   - .hour is 9, carries its zone
 */
export const Now = {
  /**
   * The system time zone id, e.g. `'Europe/Bratislava'`.
   *
   * Cached after the first call: resolving it costs about 89 microseconds and it is the
   * default argument of every other method here. Call {@link Now.refreshTimeZone} if the
   * host zone can change under a long-running process.
   */
  timeZoneId(): string {
    if (systemZone === null) systemZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return systemZone;
  },

  /** Re-read the system zone on the next {@link Now.timeZoneId} call. */
  refreshTimeZone(): void {
    systemZone = null;
  },

  /** The current moment. Has no calendar fields - ask a zone for those. */
  instant(): ChronoInstant {
    return new ChronoInstant(unsafeEpochMs(Date.now()));
  },

  /** The current moment as a plain number of epoch milliseconds. */
  epochMilliseconds(): number {
    return Date.now();
  },

  /** The current moment, read through `tz` - the system zone by default. */
  zonedDateTimeISO(tz: TimeZoneId | string = Now.timeZoneId()): ChronoZoned {
    return new ChronoZoned(unsafeEpochMs(Date.now()), checkedZone(tz));
  },

  /**
   * The current **clock reading** in `tz`, with no zone attached - what
   * `Temporal.Now.plainDateTimeISO()` returns.
   *
   * At 09:07 local this reads 09:07. It is a {@link ChronoPlain}, so it has no
   * `epochMilliseconds` to mistake for a timestamp.
   */
  plainDateTimeISO(tz: TimeZoneId | string = Now.timeZoneId()): ChronoPlain {
    const ms = Date.now();
    return new ChronoPlain(unsafeWallMs(ms + offsetAt(checkedZone(tz), unsafeEpochMs(ms))));
  },

  /** Today's **local** date in `tz`, at midnight, with no zone attached. */
  plainDateISO(tz: TimeZoneId | string = Now.timeZoneId()): ChronoPlain {
    return Now.plainDateTimeISO(tz).startOfDay();
  },

  /**
   * The current local time of day in `tz`, as minutes since midnight.
   *
   * chronofast has no `PlainTime`, so this is a number - which is what most time-of-day
   * comparisons want. Note it is not monotonic on a spring-forward day, when an hour of
   * local time does not exist.
   */
  minutesSinceMidnight(tz: TimeZoneId | string = Now.timeZoneId()): number {
    const p = Now.plainDateTimeISO(tz);
    return p.hour * 60 + p.minute;
  },
} as const;
