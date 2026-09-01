// Shared fixtures. Everything here is deterministic: no Date.now(), no Math.random(), so a
// failure is always reproducible from the test name alone.

export const MS_SEC = 1000, MS_MIN = 60_000, MS_HOUR = 3_600_000, MS_DAY = 86_400_000;

/** Deterministic LCG. Same sequence on every machine and every run. */
export function rng(seed = 0x2f6e2b1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Date.UTC maps years 0-99 onto 1900-1999, so Date.UTC(1, 0, 1) is 1901, not year 1. Every
 * test fixture below year 100 would otherwise be silently wrong - and the library, which
 * has no such quirk, would look like the thing that was broken.
 */
export const utc = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => {
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  if (y >= 0 && y <= 99) {
    const dt = new Date(t);
    dt.setUTCFullYear(y);
    return dt.getTime();
  }
  return t;
};
export const iso = (ms) => new Date(ms).toISOString();

/**
 * Instants that have historically broken date code. Every one of these is here because it
 * is a real edge, not because it looked interesting.
 */
export const EDGE_INSTANTS = [
  ['unix epoch', 0],
  ['one ms before epoch', -1],
  ['one ms after epoch', 1],
  ['1969 pre-epoch', utc(1969, 7, 20, 20, 17, 40)],
  ['leap day 2024', utc(2024, 2, 29, 12, 0, 0)],
  ['leap day 2000 (÷400 leap)', utc(2000, 2, 29, 0, 0, 0)],
  ['1900-02-28 (÷100 not leap)', utc(1900, 2, 28, 23, 59, 59, 999)],
  ['2100-02-28 (÷100 not leap)', utc(2100, 2, 28, 0, 0, 0)],
  ['end of year', utc(2024, 12, 31, 23, 59, 59, 999)],
  ['start of year', utc(2024, 1, 1, 0, 0, 0, 0)],
  ['end of a 30-day month', utc(2024, 4, 30, 23, 59, 59, 999)],
  ['end of a 31-day month', utc(2024, 1, 31, 23, 59, 59, 999)],
  ['noon', utc(2024, 6, 15, 12, 0, 0, 0)],
  ['one ms before midnight', utc(2024, 6, 15, 23, 59, 59, 999)],
  ['year 1', utc(1, 1, 1, 0, 0, 0)],
  ['year 1000', utc(1000, 1, 1)],
  ['far future', utc(9999, 12, 31, 23, 59, 59, 999)],
  ['deep past', utc(-1, 12, 31, 23, 59, 59, 999)],
];

/** Zones chosen so that every awkward property of the tz database is represented. */
export const ZONES = [
  { id: 'UTC', note: 'no offset, no DST' },
  { id: 'Europe/Bratislava', note: 'CET/CEST, EU transition dates' },
  { id: 'America/New_York', note: 'US transition dates, differ from the EU' },
  { id: 'Asia/Kolkata', note: '+05:30, never any DST' },
  { id: 'Australia/Lord_Howe', note: '30-minute DST shift' },
  { id: 'Pacific/Chatham', note: '+12:45 / +13:45' },
  { id: 'America/Sao_Paulo', note: 'abolished DST in 2019' },
  { id: 'Africa/Cairo', note: 'reintroduced DST in 2023' },
  { id: 'Asia/Tehran', note: 'abolished DST in 2022' },
  { id: 'Pacific/Apia', note: 'skipped 2011-12-30 entirely' },
  { id: 'Australia/Adelaide', note: '+09:30 with DST' },
  { id: 'Asia/Kathmandu', note: '+05:45' },
];

/** Known DST transitions, as (zone, instant just before the change). */
export const DST_TRANSITIONS = [
  ['Europe/Bratislava', utc(2024, 3, 31, 0, 59, 59), 'spring forward 02:00 -> 03:00'],
  ['Europe/Bratislava', utc(2024, 10, 27, 0, 59, 59), 'fall back 03:00 -> 02:00'],
  ['America/New_York', utc(2024, 3, 10, 6, 59, 59), 'spring forward'],
  ['America/New_York', utc(2024, 11, 3, 5, 59, 59), 'fall back'],
  ['Australia/Lord_Howe', utc(2024, 4, 6, 15, 59, 59), '30-minute fall back'],
  ['Pacific/Chatham', utc(2024, 4, 6, 14, 44, 59), '+13:45 -> +12:45'],
];

/** Generate n scattered instants across a wide span. */
export function scattered(n, seed = 1234) {
  const r = rng(seed);
  const out = new Array(n);
  const start = utc(1970, 1, 1) - 60 * 365 * MS_DAY;
  const span = 120 * 365 * MS_DAY;
  for (let i = 0; i < n; i++) out[i] = Math.floor(start + r() * span);
  return out;
}

/** Generate n instants clustered inside a short window, roughly ascending. */
export function clustered(n, seed = 4321) {
  const r = rng(seed);
  const out = new Array(n);
  let t = utc(2025, 5, 1);
  for (let i = 0; i < n; i++) { t += Math.floor(r() * 900_000); out[i] = t; }
  return out;
}

/** Canonical 24-char ISO, which takes chronofast's parse fast path. */
export const isoCanonical = (ms) => new Date(ms).toISOString();

/** Same instant written without fractional seconds, which takes the general path. */
export const isoNoFraction = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

/** Same instant written with a UTC offset instead of Z. */
export function isoWithOffset(ms, offsetMinutes) {
  const local = new Date(ms + offsetMinutes * MS_MIN);
  const p = (n, w) => String(n).padStart(w, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const a = Math.abs(offsetMinutes);
  return p(local.getUTCFullYear(), 4) + '-' + p(local.getUTCMonth() + 1, 2) + '-' +
         p(local.getUTCDate(), 2) + 'T' + p(local.getUTCHours(), 2) + ':' +
         p(local.getUTCMinutes(), 2) + ':' + p(local.getUTCSeconds(), 2) + '.' +
         p(local.getUTCMilliseconds(), 3) + sign + p(Math.floor(a / 60), 2) + ':' + p(a % 60, 2);
}
