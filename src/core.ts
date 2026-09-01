// chronoFast v2 - core UTC engine, TypeScript.
//
// Same shape as v1: an instant is a plain number, conversions are Howard Hinnant's
// integer algorithms, multi-value returns go through module-scoped scratch slots.
//
// What changed in v2, and why:
//
//   [1] CANONICAL FAST PATH in parseISO. The 24-character form
//       "YYYY-MM-DDTHH:MM:SS.sssZ" is what JSON payloads and Date#toISOString actually
//       produce. It is now matched with constant indices and validated with a single
//       branch (seventeen digit tests OR-ed together) instead of sixteen separate
//       branches walked by a moving cursor.
//   [2] CHEAP DAY VALIDATION. daysInMonth() was called on every parse; now only when
//       the day-of-month is above 28, which is roughly one parse in ten.
//   [3] MODULO INSTEAD OF DIV-MUL-SUB for time-of-day field access.
//   [4] CIVIL-DATE MEMO. daysFromCivil() is memoised on a packed y/m/d key. Consecutive
//       timestamps from the same day - the norm in logs and exports - skip the division
//       chain entirely.  (workload-sensitive)
//   [5] DAY-STRING MEMO. The "YYYY-MM-DD" prefix is cached per day index, so formatting
//       a run of same-day timestamps reuses one string.  (workload-sensitive)
//
// [4] and [5] are caches: they win on clustered data and are merely neutral on scattered
// data. They are reported separately from [1]-[3] in the benchmark for that reason.

import type { EpochMs, WallMs, DurationMs, DayIndex } from './brand.js';
import { unsafeEpochMs, unsafeDayIndex } from './brand.js';

export const MS_SEC = 1000;
export const MS_MIN = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

// ---------------------------------------------------------------- scratch slots
export let cY = 0, cM = 0, cD = 0, cH = 0, cMi = 0, cS = 0, cMs = 0;

/** Snapshot of the scratch slots, for callers that want a value instead of speed. */
export interface DateTimeFields {
  readonly year: number;
  readonly month: number;        // 1-12
  readonly day: number;          // 1-31
  readonly hour: number;         // 0-23
  readonly minute: number;       // 0-59
  readonly second: number;       // 0-59
  readonly millisecond: number;  // 0-999
}

export const readFields = (): DateTimeFields => ({
  year: cY, month: cM, day: cD, hour: cH, minute: cMi, second: cS, millisecond: cMs,
});

// ---------------------------------------------------------------- civil <-> days

export function daysFromCivil(y: number, m: number, d: number): number {
  const ya = m <= 2 ? y - 1 : y;
  const era = Math.floor(ya / 400);
  const yoe = ya - era * 400;
  const doy = (((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) | 0) + d - 1;
  const doe = yoe * 365 + ((yoe / 4) | 0) - ((yoe / 100) | 0) + doy;
  return era * 146097 + doe - 719468;
}

// [4] Memo. Key packs y/m/d into one int32; every distinct calendar day gets a distinct
// key, so a hit is always correct rather than merely likely.
let memoYmd = -1;
let memoDays = 0;

function daysFromCivilMemo(y: number, m: number, d: number): number {
  const key = ((y * 16 + m) * 32 + d) | 0;
  if (key === memoYmd) return memoDays;
  const days = daysFromCivil(y, m, d);
  memoYmd = key;
  memoDays = days;
  return days;
}

export function civilFromDays(z: number): void {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = ((doe - ((doe / 1460) | 0) + ((doe / 36524) | 0) - ((doe / 146096) | 0)) / 365) | 0;
  const doy = doe - (365 * yoe + ((yoe / 4) | 0) - ((yoe / 100) | 0));
  const mp = ((5 * doy + 2) / 153) | 0;
  const d = doy - (((153 * mp + 2) / 5) | 0) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  cY = yoe + era * 400 + (m <= 2 ? 1 : 0);
  cM = m;
  cD = d;
}

export const dayIndexOf = (ms: EpochMs | WallMs | number): DayIndex =>
  unsafeDayIndex(Math.floor(ms / MS_DAY));

export function unpack(ms: EpochMs | WallMs | number): void {
  const days = Math.floor(ms / MS_DAY);
  let rem = ms - days * MS_DAY;
  civilFromDays(days);
  cH = (rem / MS_HOUR) | 0;   rem -= cH * MS_HOUR;
  cMi = (rem / MS_MIN) | 0;   rem -= cMi * MS_MIN;
  cS = (rem / MS_SEC) | 0;
  cMs = rem - cS * MS_SEC;
}

export const pack = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, msec = 0): EpochMs =>
  unsafeEpochMs(daysFromCivil(y, m, d) * MS_DAY + h * MS_HOUR + mi * MS_MIN + s * MS_SEC + msec);

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export const isLeapYear = (y: number): boolean =>
  (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// ---------------------------------------------------------------- ISO parsing

const NOT_A_TIME = Number.NaN as EpochMs;

/**
 * Parse an ISO-8601 timestamp to epoch milliseconds.
 *
 * Accepts `YYYY-MM-DD`, an optional `T`/space time part, an optional `Z` or `±HH:mm`
 * designator, and the extended `±YYYYYY` year form. A missing designator reads as UTC.
 * Returns `NaN` (as EpochMs) on malformed input - check with `isValidInstant`.
 */
export function parseISO(s: string): EpochMs {
  const n = s.length;

  // ---- [1] canonical fast path: exactly YYYY-MM-DDTHH:MM:SS.sssZ ----
  if (n === 24 &&
      s.charCodeAt(4) === 45 && s.charCodeAt(7) === 45 && s.charCodeAt(10) === 84 &&
      s.charCodeAt(13) === 58 && s.charCodeAt(16) === 58 && s.charCodeAt(19) === 46 &&
      s.charCodeAt(23) === 90) {
    const a0 = (s.charCodeAt(0) - 48) >>> 0, a1 = (s.charCodeAt(1) - 48) >>> 0;
    const a2 = (s.charCodeAt(2) - 48) >>> 0, a3 = (s.charCodeAt(3) - 48) >>> 0;
    const b0 = (s.charCodeAt(5) - 48) >>> 0, b1 = (s.charCodeAt(6) - 48) >>> 0;
    const c0 = (s.charCodeAt(8) - 48) >>> 0, c1 = (s.charCodeAt(9) - 48) >>> 0;
    const e0 = (s.charCodeAt(11) - 48) >>> 0, e1 = (s.charCodeAt(12) - 48) >>> 0;
    const f0 = (s.charCodeAt(14) - 48) >>> 0, f1 = (s.charCodeAt(15) - 48) >>> 0;
    const g0 = (s.charCodeAt(17) - 48) >>> 0, g1 = (s.charCodeAt(18) - 48) >>> 0;
    const h0 = (s.charCodeAt(20) - 48) >>> 0, h1 = (s.charCodeAt(21) - 48) >>> 0;
    const h2 = (s.charCodeAt(22) - 48) >>> 0;

    // One branch instead of seventeen. The values are unsigned, so a non-digit has
    // already underflowed to a huge number and trips the same test as a digit above 9.
    const bad =
      (a0 > 9 ? 1 : 0) | (a1 > 9 ? 1 : 0) | (a2 > 9 ? 1 : 0) | (a3 > 9 ? 1 : 0) |
      (b0 > 9 ? 1 : 0) | (b1 > 9 ? 1 : 0) | (c0 > 9 ? 1 : 0) | (c1 > 9 ? 1 : 0) |
      (e0 > 9 ? 1 : 0) | (e1 > 9 ? 1 : 0) | (f0 > 9 ? 1 : 0) | (f1 > 9 ? 1 : 0) |
      (g0 > 9 ? 1 : 0) | (g1 > 9 ? 1 : 0) | (h0 > 9 ? 1 : 0) | (h1 > 9 ? 1 : 0) |
      (h2 > 9 ? 1 : 0);
    if (bad !== 0) return NOT_A_TIME;

    const mon = b0 * 10 + b1;
    const day = c0 * 10 + c1;
    const hh = e0 * 10 + e1;
    const mi = f0 * 10 + f1;
    const ss = g0 * 10 + g1;
    // Unsigned compares so that month 0 and day 0 are rejected by the same test.
    if ((mon - 1) >>> 0 > 11 || (day - 1) >>> 0 > 30 || hh > 23 || mi > 59 || ss > 59) {
      return NOT_A_TIME;
    }
    const y = a0 * 1000 + a1 * 100 + a2 * 10 + a3;
    if (day > 28 && day > daysInMonth(y, mon)) return NOT_A_TIME;   // [2]

    return unsafeEpochMs(
      daysFromCivilMemo(y, mon, day) * MS_DAY +                      // [4]
      hh * MS_HOUR + mi * MS_MIN + ss * MS_SEC + (h0 * 100 + h1 * 10 + h2),
    );
  }

  return parseISOGeneral(s, n);
}

function parseISOGeneral(s: string, n: number): EpochMs {
  if (n < 10) return NOT_A_TIME;

  let i = 0;
  let y = 0;

  const c0 = s.charCodeAt(0);
  if (c0 === 43 || c0 === 45) {
    if (n < 17) return NOT_A_TIME;
    let acc = 0;
    for (let k = 1; k < 7; k++) {
      const d = s.charCodeAt(k) - 48;
      if (d >>> 0 > 9) return NOT_A_TIME;
      acc = acc * 10 + d;
    }
    if (c0 === 45 && acc === 0) return NOT_A_TIME;
    y = c0 === 45 ? -acc : acc;
    i = 7;
  } else {
    const a = s.charCodeAt(0) - 48, b = s.charCodeAt(1) - 48;
    const c = s.charCodeAt(2) - 48, d = s.charCodeAt(3) - 48;
    if (a >>> 0 > 9 || b >>> 0 > 9 || c >>> 0 > 9 || d >>> 0 > 9) return NOT_A_TIME;
    y = a * 1000 + b * 100 + c * 10 + d;
    i = 4;
  }

  if (s.charCodeAt(i) !== 45) return NOT_A_TIME;
  const m1 = s.charCodeAt(i + 1) - 48, m2 = s.charCodeAt(i + 2) - 48;
  if (m1 >>> 0 > 9 || m2 >>> 0 > 9) return NOT_A_TIME;
  const mon = m1 * 10 + m2;
  if (mon < 1 || mon > 12) return NOT_A_TIME;
  if (s.charCodeAt(i + 3) !== 45) return NOT_A_TIME;
  const d1 = s.charCodeAt(i + 4) - 48, d2 = s.charCodeAt(i + 5) - 48;
  if (d1 >>> 0 > 9 || d2 >>> 0 > 9) return NOT_A_TIME;
  const day = d1 * 10 + d2;
  if (day < 1 || day > 31) return NOT_A_TIME;
  if (day > 28 && day > daysInMonth(y, mon)) return NOT_A_TIME;      // [2]
  i += 6;

  let h = 0, mi = 0, sec = 0, frac = 0;

  if (i < n) {
    const sep = s.charCodeAt(i);
    if (sep === 84 || sep === 116 || sep === 32) {
      i++;
      const h1 = s.charCodeAt(i) - 48, h2 = s.charCodeAt(i + 1) - 48;
      if (h1 >>> 0 > 9 || h2 >>> 0 > 9) return NOT_A_TIME;
      h = h1 * 10 + h2;
      if (h > 23) return NOT_A_TIME;
      if (s.charCodeAt(i + 2) !== 58) return NOT_A_TIME;
      const n1 = s.charCodeAt(i + 3) - 48, n2 = s.charCodeAt(i + 4) - 48;
      if (n1 >>> 0 > 9 || n2 >>> 0 > 9) return NOT_A_TIME;
      mi = n1 * 10 + n2;
      if (mi > 59) return NOT_A_TIME;
      i += 5;

      if (s.charCodeAt(i) === 58) {
        const s1 = s.charCodeAt(i + 1) - 48, s2 = s.charCodeAt(i + 2) - 48;
        if (s1 >>> 0 > 9 || s2 >>> 0 > 9) return NOT_A_TIME;
        sec = s1 * 10 + s2;
        if (sec > 59) return NOT_A_TIME;
        i += 3;

        const dot = s.charCodeAt(i);
        if (dot === 46 || dot === 44) {
          i++;
          let k = 0;
          let scale = 100;
          while (i < n) {
            const d = s.charCodeAt(i) - 48;
            if (d >>> 0 > 9) break;
            if (k < 3) frac += d * scale;
            scale = (scale / 10) | 0;
            k++;
            i++;
          }
          if (k === 0) return NOT_A_TIME;
        }
      }
    }
  }

  const base = daysFromCivilMemo(y, mon, day) * MS_DAY +
               h * MS_HOUR + mi * MS_MIN + sec * MS_SEC + frac;

  if (i >= n) return unsafeEpochMs(base);

  const z = s.charCodeAt(i);
  if (z === 90 || z === 122) return i + 1 === n ? unsafeEpochMs(base) : NOT_A_TIME;
  if (z !== 43 && z !== 45) return NOT_A_TIME;

  const oh1 = s.charCodeAt(i + 1) - 48, oh2 = s.charCodeAt(i + 2) - 48;
  if (oh1 >>> 0 > 9 || oh2 >>> 0 > 9) return NOT_A_TIME;
  const oh = oh1 * 10 + oh2;
  if (oh > 23) return NOT_A_TIME;
  i += 3;

  let om = 0;
  if (i < n) {
    if (s.charCodeAt(i) === 58) i++;
    const om1 = s.charCodeAt(i) - 48, om2 = s.charCodeAt(i + 1) - 48;
    if (om1 >>> 0 > 9 || om2 >>> 0 > 9) return NOT_A_TIME;
    om = om1 * 10 + om2;
    if (om > 59) return NOT_A_TIME;
    i += 2;
    if (i !== n) return NOT_A_TIME;
  }

  const off = oh * MS_HOUR + om * MS_MIN;
  return unsafeEpochMs(z === 45 ? base + off : base - off);
}

// ---------------------------------------------------------------- ISO formatting

const D2: readonly string[] = /* @__PURE__ */ (() => {
  const a = new Array<string>(100);
  for (let i = 0; i < 100; i++) a[i] = (i < 10 ? '0' : '') + i;
  return a;
})();

const D3: readonly string[] = /* @__PURE__ */ (() => {
  const a = new Array<string>(1000);
  for (let i = 0; i < 1000; i++) a[i] = i < 10 ? '00' + i : i < 100 ? '0' + i : '' + i;
  return a;
})();

function year6(y: number): string {
  const a = y < 0 ? -y : y;
  const p = a < 10 ? '00000' : a < 100 ? '0000' : a < 1000 ? '000'
          : a < 10000 ? '00' : a < 100000 ? '0' : '';
  return (y < 0 ? '-' : '+') + p + a;
}

// [5] Day-string memo. A run of timestamps from one day reuses a single prefix string.
let dayStrIdx = Number.NaN;
let dayStrVal = '';

function dayString(dayIdx: number): string {
  if (dayIdx === dayStrIdx) return dayStrVal;
  civilFromDays(dayIdx);
  const y = cY;
  const s = y >= 0 && y <= 9999
    ? String.fromCharCode(
        48 + ((y / 1000) | 0), 48 + (((y / 100) | 0) % 10), 48 + (((y / 10) | 0) % 10), 48 + (y % 10),
        45, 48 + ((cM / 10) | 0), 48 + (cM % 10), 45, 48 + ((cD / 10) | 0), 48 + (cD % 10))
    : year6(y) + '-' + D2[cM]! + '-' + D2[cD]!;
  dayStrIdx = dayIdx;
  dayStrVal = s;
  return s;
}

// [8] Emit the whole 24-character result with ONE String.fromCharCode call rather than a
// chain of concatenations. Measured 31% faster on scattered input. It is ~10% slower than
// a cached prefix when every timestamp lands on the same day, because the string memo can
// skip construction entirely - but the scattered win is three times the clustered loss, so
// this is the better default. Caching the decomposed y/m/d instead was tried and refuted:
// civilFromDays is already cheap, and the cache check cost more than it saved.
function isoExtendedYear(rem: number): string {
  const ys = year6(cY);
  const h = (rem / MS_HOUR) | 0;  rem -= h * MS_HOUR;
  const mi = (rem / MS_MIN) | 0;  rem -= mi * MS_MIN;
  const s = (rem / MS_SEC) | 0;
  return ys + '-' + D2[cM]! + '-' + D2[cD]! + 'T' +
         D2[h]! + ':' + D2[mi]! + ':' + D2[s]! + '.' + D3[rem - s * MS_SEC]! + 'Z';
}

/** Byte-for-byte equal to `Date.prototype.toISOString()`. */
export function toISO(ms: EpochMs): string {
  const days = Math.floor(ms / MS_DAY);
  let rem = ms - days * MS_DAY;
  civilFromDays(days);
  const y = cY;
  if (y < 0 || y > 9999) return isoExtendedYear(rem);   // rare, keep the slow path
  const h = (rem / MS_HOUR) | 0;  rem -= h * MS_HOUR;
  const mi = (rem / MS_MIN) | 0;  rem -= mi * MS_MIN;
  const sec = (rem / MS_SEC) | 0; rem -= sec * MS_SEC;
  return String.fromCharCode(
    48 + ((y / 1000) | 0), 48 + (((y / 100) | 0) % 10), 48 + (((y / 10) | 0) % 10), 48 + (y % 10), 45,
    48 + ((cM / 10) | 0), 48 + (cM % 10), 45,
    48 + ((cD / 10) | 0), 48 + (cD % 10), 84,
    48 + ((h / 10) | 0), 48 + (h % 10), 58,
    48 + ((mi / 10) | 0), 48 + (mi % 10), 58,
    48 + ((sec / 10) | 0), 48 + (sec % 10), 46,
    48 + ((rem / 100) | 0), 48 + (((rem / 10) | 0) % 10), 48 + (rem % 10), 90);
}

/**
 * `YYYY-MM-DD` in UTC - the grouping key for daily aggregation.
 * Here the memo IS kept: the entire result depends only on the day, so a hit returns a
 * cached string and does no work at all (9ns against 47ns). Misses now emit through
 * fromCharCode too, which is 11% faster than the old concatenation.
 */
export const toISODate = (ms: EpochMs): string => dayString(Math.floor(ms / MS_DAY));

// ---------------------------------------------------------------- field access

export const getYear = (ms: EpochMs): number => { civilFromDays(Math.floor(ms / MS_DAY)); return cY; };
export const getMonth = (ms: EpochMs): number => { civilFromDays(Math.floor(ms / MS_DAY)); return cM; };
export const getDay = (ms: EpochMs): number => { civilFromDays(Math.floor(ms / MS_DAY)); return cD; };

// [3] modulo, rather than floor-multiply-subtract
export function getHour(ms: EpochMs): number {
  const r = ms % MS_DAY;
  return (((r < 0 ? r + MS_DAY : r) / MS_HOUR) | 0);
}
export function getMinute(ms: EpochMs): number {
  const r = ms % MS_HOUR;
  return (((r < 0 ? r + MS_HOUR : r) / MS_MIN) | 0);
}
export function getSecond(ms: EpochMs): number {
  const r = ms % MS_MIN;
  return (((r < 0 ? r + MS_MIN : r) / MS_SEC) | 0);
}
export function getMillisecond(ms: EpochMs): number {
  const r = ms % MS_SEC;
  return r < 0 ? r + MS_SEC : r;
}

/** 0 = Sunday, matching `Date.prototype.getUTCDay()`. */
export function dayOfWeek(ms: EpochMs): number {
  const w = (Math.floor(ms / MS_DAY) + 4) % 7;
  return w < 0 ? w + 7 : w;
}

/** 1 = Monday .. 7 = Sunday, matching `Temporal.PlainDate#dayOfWeek`. */
export function isoDayOfWeek(ms: EpochMs): number {
  const w = (Math.floor(ms / MS_DAY) + 3) % 7;
  return (w < 0 ? w + 7 : w) + 1;
}

// [9] The week number needs the day index of Jan 1 of the ISO week-year. That was a second
// full civil conversion per call; years are few, so a small table serves instead.
const JAN1_LO = 1700, JAN1_N = 600;
const jan1Days = new Int32Array(JAN1_N);
const jan1Known = new Uint8Array(JAN1_N);

function jan1Of(y: number): number {
  const i = y - JAN1_LO;
  if (i >>> 0 >= JAN1_N) return daysFromCivil(y, 1, 1);
  if (jan1Known[i] === 1) return jan1Days[i]!;
  const d = daysFromCivil(y, 1, 1);
  jan1Days[i] = d;
  jan1Known[i] = 1;
  return d;
}

export function isoWeek(ms: EpochMs): number {
  const days = Math.floor(ms / MS_DAY);
  const dowMon = (((days + 3) % 7) + 7) % 7;
  const thursday = days - dowMon + 3;
  civilFromDays(thursday);
  return (((thursday - jan1Of(cY)) / 7) | 0) + 1;
}

export function isoWeekYear(ms: EpochMs): number {
  const days = Math.floor(ms / MS_DAY);
  const dowMon = (((days + 3) % 7) + 7) % 7;
  civilFromDays(days - dowMon + 3);
  return cY;
}

export function dayOfYear(ms: EpochMs): number {
  const days = Math.floor(ms / MS_DAY);
  civilFromDays(days);
  return days - daysFromCivil(cY, 1, 1) + 1;
}

// ---------------------------------------------------------------- arithmetic (UTC)

export const addMilliseconds = (ms: EpochMs, n: DurationMs | number): EpochMs => unsafeEpochMs(ms + n);
export const addSeconds = (ms: EpochMs, n: number): EpochMs => unsafeEpochMs(ms + n * MS_SEC);
export const addMinutes = (ms: EpochMs, n: number): EpochMs => unsafeEpochMs(ms + n * MS_MIN);
export const addHours = (ms: EpochMs, n: number): EpochMs => unsafeEpochMs(ms + n * MS_HOUR);
export const addDays = (ms: EpochMs, n: number): EpochMs => unsafeEpochMs(ms + n * MS_DAY);
export const addWeeks = (ms: EpochMs, n: number): EpochMs => unsafeEpochMs(ms + n * 7 * MS_DAY);

/** Calendar month arithmetic, clamping to end of month (Jan 31 + 1mo -> Feb 28/29). */
// [10] daysInMonth was a call with a chain of comparisons; a 12-entry table plus one
// leap check for February is cheaper.
const MONTH_LEN: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function addMonths(ms: EpochMs, n: number): EpochMs {
  const days = Math.floor(ms / MS_DAY);
  const tod = ms - days * MS_DAY;
  civilFromDays(days);
  const total = cY * 12 + (cM - 1) + n;
  const y = Math.floor(total / 12);
  const m0 = total - y * 12;                          // 0-11
  let dim = MONTH_LEN[m0]!;
  if (m0 === 1 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) dim = 29;
  const d = cD > dim ? dim : cD;
  return unsafeEpochMs(daysFromCivil(y, m0 + 1, d) * MS_DAY + tod);
}

export const addYears = (ms: EpochMs, n: number): EpochMs => addMonths(ms, n * 12);

// ---------------------------------------------------------------- truncation (UTC)

export function startOfDay(ms: EpochMs): EpochMs {
  const r = ms % MS_DAY;
  return unsafeEpochMs(r < 0 ? ms - r - MS_DAY : ms - r);
}
export function startOfHour(ms: EpochMs): EpochMs {
  const r = ms % MS_HOUR;
  return unsafeEpochMs(r < 0 ? ms - r - MS_HOUR : ms - r);
}
export function startOfMinute(ms: EpochMs): EpochMs {
  const r = ms % MS_MIN;
  return unsafeEpochMs(r < 0 ? ms - r - MS_MIN : ms - r);
}
export function startOfMonth(ms: EpochMs): EpochMs {
  civilFromDays(Math.floor(ms / MS_DAY));
  return unsafeEpochMs(daysFromCivil(cY, cM, 1) * MS_DAY);
}
export function startOfYear(ms: EpochMs): EpochMs {
  civilFromDays(Math.floor(ms / MS_DAY));
  return unsafeEpochMs(daysFromCivil(cY, 1, 1) * MS_DAY);
}
export function startOfWeek(ms: EpochMs, firstDay = 1): EpochMs {
  const days = Math.floor(ms / MS_DAY);
  const dow = (((days + 4) % 7) + 7) % 7;
  const delta = (((dow - firstDay) % 7) + 7) % 7;
  return unsafeEpochMs((days - delta) * MS_DAY);
}

// ---------------------------------------------------------------- differences

export const diffMilliseconds = (a: EpochMs, b: EpochMs): number => b - a;
export const diffDays = (a: EpochMs, b: EpochMs): number =>
  Math.floor(b / MS_DAY) - Math.floor(a / MS_DAY);

/** Whole calendar months from a to b, truncated toward zero. */
export function diffMonths(a: EpochMs, b: EpochMs): number {
  civilFromDays(Math.floor(a / MS_DAY)); const ay = cY, am = cM, ad = cD;
  civilFromDays(Math.floor(b / MS_DAY)); const by = cY, bm = cM, bd = cD;
  let d = (by - ay) * 12 + (bm - am);
  if (d > 0 && bd < ad) d--;
  else if (d < 0 && bd > ad) d++;
  return d;
}

export const diffYears = (a: EpochMs, b: EpochMs): number => (diffMonths(a, b) / 12) | 0;

// ---------------------------------------------------------------- comparison

export const compare = (a: EpochMs, b: EpochMs): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
export const isBefore = (a: EpochMs, b: EpochMs): boolean => a < b;
export const isAfter = (a: EpochMs, b: EpochMs): boolean => a > b;
export const min = (a: EpochMs, b: EpochMs): EpochMs => (a < b ? a : b);
export const max = (a: EpochMs, b: EpochMs): EpochMs => (a > b ? a : b);

/** Reset the internal memos. Only useful for benchmarking a cold cache. */
export function resetMemos(): void {
  memoYmd = -1;
  memoDays = 0;
  dayStrIdx = Number.NaN;
  dayStrVal = '';
}
