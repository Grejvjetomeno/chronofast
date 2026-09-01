// chronoFast v2 - public surface.
//
// Two layers, as in v1: raw functions over branded numbers for the hot path, and a thin
// immutable object layer so the API can be compared like-for-like against Date and
// Temporal. The classes hold exactly one own field and never mutate it, which keeps a
// single hidden class alive for every instance.

// Public surface: the two classes, the three errors they throw, and only those types
// that appear in their signatures. Everything else - the raw epoch-ms function layer,
// the internal brand helpers, the cache introspection - lives behind
// 'chronofast/core' and 'chronofast/zone'.
export type { EpochMs, TimeZoneId } from './brand.js';
export { InvalidInstantError, UnknownTimeZoneError } from './brand.js';
export type { DateTimeFields } from './core.js';
export type { Disambiguation } from './zone.js';
export { AmbiguousTimeError } from './zone.js';

import type { EpochMs, TimeZoneId } from './brand.js';
import { unsafeEpochMs, unsafeWallMs, epochMs as checkedEpochMs, timeZone as checkedZone } from './brand.js';
import {
  MS_HOUR, MS_MIN, MS_SEC, parseISO, toISO, toISODate, unpack, readFields,
  addMilliseconds, addSeconds, addMinutes, addHours, addDays, addWeeks, addMonths, addYears,
  startOfDay, startOfHour, startOfMinute, startOfMonth, startOfYear, startOfWeek,
  diffDays, diffMonths, isoDayOfWeek, isoWeek, isoWeekYear, dayOfYear,
  getYear, getMonth, getDay, getHour, getMinute, getSecond, getMillisecond,
  type DateTimeFields,
} from './core.js';
import {
  offsetAt, utcFromWall, formatZoned, toZonedISODate, startOfDayZoned,
  addDaysZoned, addMonthsZoned, zonedFields, type Disambiguation,
} from './zone.js';
import { daysFromCivil, MS_DAY, cY, cM, cD, cH, cMi, cS, cMs } from './core.js';

/**
 * An instant on the UTC timeline, to millisecond precision. Immutable.
 *
 * Unlike `Temporal.Instant`, calendar fields are readable directly (`.year`, `.month`,
 * `.day`) and are always UTC. Use `inZone()` to read them through an IANA zone instead.
 */
export class ChronoInstant {
  readonly ms: EpochMs;

  constructor(ms: EpochMs) {
    this.ms = ms;
  }

  static parse(s: string): ChronoInstant { return new ChronoInstant(parseISO(s)); }
  /** Validates. Throws `InvalidInstantError` on NaN, Infinity, or out-of-range input. */
  static fromEpochMs(ms: number): ChronoInstant { return new ChronoInstant(checkedEpochMs(ms)); }
  static now(): ChronoInstant { return new ChronoInstant(unsafeEpochMs(Date.now())); }
  static fromDate(d: Date): ChronoInstant { return new ChronoInstant(unsafeEpochMs(d.getTime())); }

  static compare(a: ChronoInstant, b: ChronoInstant): -1 | 0 | 1 {
    return a.ms < b.ms ? -1 : a.ms > b.ms ? 1 : 0;
  }

  get epochMilliseconds(): number { return this.ms; }
  get isValid(): boolean { return !Number.isNaN(this.ms); }

  get year(): number { return getYear(this.ms); }
  get month(): number { return getMonth(this.ms); }
  get day(): number { return getDay(this.ms); }
  get hour(): number { return getHour(this.ms); }
  get minute(): number { return getMinute(this.ms); }
  get second(): number { return getSecond(this.ms); }
  get millisecond(): number { return getMillisecond(this.ms); }
  get dayOfWeek(): number { return isoDayOfWeek(this.ms); }
  get dayOfYear(): number { return dayOfYear(this.ms); }
  get weekOfYear(): number { return isoWeek(this.ms); }
  get weekYear(): number { return isoWeekYear(this.ms); }

  /** All seven fields from a single civil conversion, rather than one per getter. */
  fields(): DateTimeFields { unpack(this.ms); return readFields(); }

  addMilliseconds(n: number): ChronoInstant { return new ChronoInstant(addMilliseconds(this.ms, n)); }
  addSeconds(n: number): ChronoInstant { return new ChronoInstant(addSeconds(this.ms, n)); }
  addMinutes(n: number): ChronoInstant { return new ChronoInstant(addMinutes(this.ms, n)); }
  addHours(n: number): ChronoInstant { return new ChronoInstant(addHours(this.ms, n)); }
  addDays(n: number): ChronoInstant { return new ChronoInstant(addDays(this.ms, n)); }
  addWeeks(n: number): ChronoInstant { return new ChronoInstant(addWeeks(this.ms, n)); }
  addMonths(n: number): ChronoInstant { return new ChronoInstant(addMonths(this.ms, n)); }
  addYears(n: number): ChronoInstant { return new ChronoInstant(addYears(this.ms, n)); }

  startOfMinute(): ChronoInstant { return new ChronoInstant(startOfMinute(this.ms)); }
  startOfHour(): ChronoInstant { return new ChronoInstant(startOfHour(this.ms)); }
  startOfDay(): ChronoInstant { return new ChronoInstant(startOfDay(this.ms)); }
  startOfWeek(firstDay?: number): ChronoInstant { return new ChronoInstant(startOfWeek(this.ms, firstDay)); }
  startOfMonth(): ChronoInstant { return new ChronoInstant(startOfMonth(this.ms)); }
  startOfYear(): ChronoInstant { return new ChronoInstant(startOfYear(this.ms)); }

  daysUntil(other: ChronoInstant): number { return diffDays(this.ms, other.ms); }
  monthsUntil(other: ChronoInstant): number { return diffMonths(this.ms, other.ms); }

  equals(other: ChronoInstant): boolean { return this.ms === other.ms; }
  isBefore(other: ChronoInstant): boolean { return this.ms < other.ms; }
  isAfter(other: ChronoInstant): boolean { return this.ms > other.ms; }

  /** Throws `UnknownTimeZoneError` if the zone id is not one Intl recognises. */
  inZone(tz: TimeZoneId | string): ChronoZoned { return new ChronoZoned(this.ms, checkedZone(tz)); }
  toDate(): Date { return new Date(this.ms); }

  toISOString(): string { return toISO(this.ms); }
  toISODate(): string { return toISODate(this.ms); }
  toString(): string { return toISO(this.ms); }
  toJSON(): string { return toISO(this.ms); }
  valueOf(): number { return this.ms; }
}

/** The same instant, read through an IANA time zone. Immutable. */
export class ChronoZoned {
  readonly ms: EpochMs;
  readonly tz: TimeZoneId | string;

  constructor(ms: EpochMs, tz: TimeZoneId | string) {
    this.ms = ms;
    this.tz = tz;
  }

  static parse(s: string, tz: TimeZoneId | string): ChronoZoned {
    return new ChronoZoned(parseISO(s), checkedZone(tz));
  }
  /** Validates both arguments. */
  static fromEpochMs(ms: number, tz: TimeZoneId | string): ChronoZoned {
    return new ChronoZoned(checkedEpochMs(ms), checkedZone(tz));
  }

  /** Interpret local wall-clock fields in this zone, resolving gaps and ambiguity. */
  static fromLocal(
    tz: TimeZoneId | string,
    y: number, mo: number, d: number,
    h = 0, mi = 0, s = 0, msec = 0,
    disambiguation: Disambiguation = 'compatible',
  ): ChronoZoned {
    const zoneId = checkedZone(tz);
    const wall = daysFromCivil(y, mo, d) * MS_DAY + h * MS_HOUR + mi * MS_MIN + s * MS_SEC + msec;
    return new ChronoZoned(utcFromWall(zoneId, unsafeWallMs(wall), disambiguation), zoneId);
  }

  get epochMilliseconds(): number { return this.ms; }
  get offset(): number { return offsetAt(this.tz, this.ms); }
  get offsetHours(): number { return offsetAt(this.tz, this.ms) / MS_HOUR; }

  get year(): number { zonedFields(this.tz, this.ms); return cY; }
  get month(): number { zonedFields(this.tz, this.ms); return cM; }
  get day(): number { zonedFields(this.tz, this.ms); return cD; }
  get hour(): number { zonedFields(this.tz, this.ms); return cH; }
  get minute(): number { zonedFields(this.tz, this.ms); return cMi; }
  get second(): number { zonedFields(this.tz, this.ms); return cS; }
  get millisecond(): number { zonedFields(this.tz, this.ms); return cMs; }

  fields(): DateTimeFields { zonedFields(this.tz, this.ms); return readFields(); }

  addHours(n: number): ChronoZoned { return new ChronoZoned(unsafeEpochMs(this.ms + n * MS_HOUR), this.tz); }
  addMinutes(n: number): ChronoZoned { return new ChronoZoned(unsafeEpochMs(this.ms + n * MS_MIN), this.tz); }
  addSeconds(n: number): ChronoZoned { return new ChronoZoned(unsafeEpochMs(this.ms + n * MS_SEC), this.tz); }

  addDays(n: number): ChronoZoned { return new ChronoZoned(addDaysZoned(this.tz, this.ms, n), this.tz); }
  addMonths(n: number): ChronoZoned { return new ChronoZoned(addMonthsZoned(this.tz, this.ms, n), this.tz); }
  addYears(n: number): ChronoZoned { return new ChronoZoned(addMonthsZoned(this.tz, this.ms, n * 12), this.tz); }

  startOfDay(): ChronoZoned { return new ChronoZoned(startOfDayZoned(this.tz, this.ms), this.tz); }

  withZone(tz: TimeZoneId | string): ChronoZoned { return new ChronoZoned(this.ms, checkedZone(tz)); }
  toInstant(): ChronoInstant { return new ChronoInstant(this.ms); }
  toDate(): Date { return new Date(this.ms); }

  toISOString(): string { return formatZoned(this.tz, this.ms); }
  toISODate(): string { return toZonedISODate(this.tz, this.ms); }
  toString(): string { return formatZoned(this.tz, this.ms) + '[' + this.tz + ']'; }
  toJSON(): string { return formatZoned(this.tz, this.ms); }
  valueOf(): number { return this.ms; }
}
