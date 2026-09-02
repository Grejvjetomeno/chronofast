// The scenario matrix.
//
// Every scenario is a TASK stated in runtime-neutral terms ("ISO string in, epoch
// milliseconds out"), and each contender implements it the way its own API makes
// natural. No contender is handed a shortcut the others are denied, and every
// implementation is checked to produce an identical result before anything is timed.
//
// Two framings appear deliberately:
//   "from epoch ms"     - input is a number, so object-based libraries pay construction
//                         cost. This is the interop case: data arrives as JSON or from
//                         a database driver.
//   "native object in"  - input is already the contender's own type, isolating the
//                         arithmetic from the construction. This is the case where
//                         Temporal looks much better, and it deserves to be shown.

import * as dtz from './native-date-tz.js';
import { TZ, MASK, MS, MS_B, MS_DST, ISO_UTC, ISO_OFF, BULK, BULK_ISO, BULK_MS, SORT_MS, SORT_N } from './data.js';

const FSD = { fractionalSecondDigits: 3 };
const ZFMT = { timeZoneName: 'never', fractionalSecondDigits: 3 };

// Checksum helpers so bulk scenarios return one comparable number.
const ckStr = (s, acc) => (Math.imul(acc, 31) + s.charCodeAt(s.length - 1)) | 0;

export const SCENARIOS = [
  // ================================================================ PARSING
  {
    id: 'parse-utc', group: 'Parsing', returns: 'number',
    name: 'Parse ISO-8601 UTC string',
    note: '"2024-03-15T10:30:00.123Z" to epoch ms. The JSON/API hot path.',
    impls: {
      date: () => (i) => Date.parse(ISO_UTC[i & MASK]),
      chronoRaw: (C) => (i) => C.parseISO(ISO_UTC[i & MASK]),
      dayjs: (D) => (i) => D.utc(ISO_UTC[i & MASK]).valueOf(),
      chronoObj: (C) => (i) => C.ChronoInstant.parse(ISO_UTC[i & MASK]).ms,
      temporal: (T) => (i) => T.Instant.from(ISO_UTC[i & MASK]).epochMilliseconds,
    },
  },
  {
    id: 'parse-offset', group: 'Parsing', returns: 'number',
    name: 'Parse ISO-8601 with UTC offset',
    note: '"2024-03-15T12:30:00.123+02:00" to epoch ms.',
    impls: {
      date: () => (i) => Date.parse(ISO_OFF[i & MASK]),
      chronoRaw: (C) => (i) => C.parseISO(ISO_OFF[i & MASK]),
      dayjs: (D) => (i) => D.utc(ISO_OFF[i & MASK]).valueOf(),
      chronoObj: (C) => (i) => C.ChronoInstant.parse(ISO_OFF[i & MASK]).ms,
      temporal: (T) => (i) => T.Instant.from(ISO_OFF[i & MASK]).epochMilliseconds,
    },
  },

  // ================================================================ FORMATTING
  {
    id: 'format-iso', group: 'Formatting', returns: 'string',
    name: 'Format epoch ms to ISO-8601 UTC',
    note: 'Serialising back out. Fixed 3 fractional digits for all contenders.',
    impls: {
      date: () => (i) => new Date(MS[i & MASK]).toISOString(),
      chronoRaw: (C) => (i) => C.toISO(MS[i & MASK]),
      dayjs: (D) => (i) => D.utc(MS[i & MASK]).toISOString(),
      chronoObj: (C) => (i) => new C.ChronoInstant(MS[i & MASK]).toISOString(),
      temporal: (T) => (i) => T.Instant.fromEpochMilliseconds(MS[i & MASK]).toString(FSD),
    },
  },
  {
    id: 'format-date-key', group: 'Formatting', returns: 'string',
    name: 'Format epoch ms to YYYY-MM-DD (UTC)',
    note: 'The grouping key for daily aggregation.',
    impls: {
      date: () => (i) => new Date(MS[i & MASK]).toISOString().slice(0, 10),
      chronoRaw: (C) => (i) => C.toISODate(MS[i & MASK]),
      chronoObj: (C) => (i) => new C.ChronoInstant(MS[i & MASK]).toISODate(),
      dayjs: (D) => (i) => D.utc(MS[i & MASK]).format('YYYY-MM-DD'),
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS[i & MASK]).toZonedDateTimeISO('UTC').toPlainDate().toString(),
    },
  },

  // ================================================================ ARITHMETIC, from epoch ms
  {
    id: 'add-days', group: 'Arithmetic (from epoch ms)', returns: 'number',
    name: 'Add 7 days',
    note: 'Input and output are epoch ms, so object libraries pay construction cost.',
    impls: {
      date: () => (i) => { const d = new Date(MS[i & MASK]); d.setUTCDate(d.getUTCDate() + 7); return d.getTime(); },
      chronoRaw: (C) => (i) => C.addDays(MS[i & MASK], 7),
      dayjs: (D) => (i) => D.utc(MS[i & MASK]).add(7, 'day').valueOf(),
      chronoObj: (C) => (i) => new C.ChronoInstant(MS[i & MASK]).addDays(7).ms,
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS[i & MASK]).toZonedDateTimeISO('UTC').add({ days: 7 }).epochMilliseconds,
    },
  },
  {
    id: 'add-months', group: 'Arithmetic (from epoch ms)', returns: 'number',
    name: 'Add 1 month, end-of-month clamped',
    note: 'Jan 31 + 1 month is Feb 28/29. The naive Date setUTCMonth overflows, so the ' +
          'Date implementation does the clamping people forget to write.',
    impls: {
      date: () => (i) => {
        const d = new Date(MS[i & MASK]);
        const day = d.getUTCDate();
        const target = d.getUTCMonth() + 1;
        const y = d.getUTCFullYear() + Math.floor(target / 12);
        const m = ((target % 12) + 12) % 12;
        const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        return Date.UTC(y, m, day < dim ? day : dim, d.getUTCHours(), d.getUTCMinutes(),
                        d.getUTCSeconds(), d.getUTCMilliseconds());
      },
      chronoRaw: (C) => (i) => C.addMonths(MS[i & MASK], 1),
      dayjs: (D) => (i) => D.utc(MS[i & MASK]).add(1, 'month').valueOf(),
      chronoObj: (C) => (i) => new C.ChronoPlain(MS[i & MASK]).addMonths(1).wall,
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS[i & MASK]).toZonedDateTimeISO('UTC').add({ months: 1 }).epochMilliseconds,
    },
  },
  {
    id: 'start-of-day', group: 'Arithmetic (from epoch ms)', returns: 'number',
    name: 'Truncate to start of UTC day',
    note: 'Bucketing timestamps into days.',
    impls: {
      date: () => (i) => { const d = new Date(MS[i & MASK]); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); },
      chronoRaw: (C) => (i) => C.startOfDay(MS[i & MASK]),
      dayjs: (D) => (i) => D.utc(MS[i & MASK]).startOf('day').valueOf(),
      chronoObj: (C) => (i) => new C.ChronoPlain(MS[i & MASK]).startOfDay().wall,
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS[i & MASK]).toZonedDateTimeISO('UTC').startOfDay().epochMilliseconds,
    },
  },
  {
    id: 'diff-days', group: 'Arithmetic (from epoch ms)', returns: 'number',
    name: 'Whole calendar days between two instants',
    impls: {
      date: () => (i) => {
        const a = new Date(MS[i & MASK]), b = new Date(MS_B[i & MASK]);
        return (Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
                Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 86400000;
      },
      chronoRaw: (C) => (i) => C.diffDays(MS[i & MASK], MS_B[i & MASK]),
      chronoObj: (C) => (i) => new C.ChronoPlain(MS[i & MASK]).daysUntil(new C.ChronoPlain(MS_B[i & MASK])),
      dayjs: (D) => (i) => D.utc(MS_B[i & MASK]).startOf('day').diff(D.utc(MS[i & MASK]).startOf('day'), 'day'),
      temporal: (T) => (i) => {
        const a = T.Instant.fromEpochMilliseconds(MS[i & MASK]).toZonedDateTimeISO('UTC').toPlainDate();
        const b = T.Instant.fromEpochMilliseconds(MS_B[i & MASK]).toZonedDateTimeISO('UTC').toPlainDate();
        return a.until(b, { largestUnit: 'day' }).days;
      },
    },
  },

  // ================================================================ ARITHMETIC, native object in
  {
    id: 'add-days-obj', group: 'Arithmetic (native object in)', returns: 'number',
    name: 'Add 7 days to an existing instance',
    note: 'No construction from ms. Isolates the arithmetic itself. Date must be copied ' +
          'first because it is mutable; the immutable libraries do not.',
    impls: {
      date: () => { const a = MS.map((m) => new Date(m)); return (i) => { const d = new Date(a[i & MASK]); d.setUTCDate(d.getUTCDate() + 7); return d.getTime(); }; },
      chronoObj: (C) => { const a = MS.map((m) => new C.ChronoInstant(m)); return (i) => a[i & MASK].addDays(7).ms; },
      dayjs: (D) => { const a = MS.map((m) => D.utc(m)); return (i) => a[i & MASK].add(7, 'day').valueOf(); },
      temporal: (T) => {
        const a = MS.map((m) => T.Instant.fromEpochMilliseconds(m).toZonedDateTimeISO('UTC'));
        return (i) => a[i & MASK].add({ days: 7 }).epochMilliseconds;
      },
    },
  },
  {
    id: 'add-months-obj', group: 'Arithmetic (native object in)', returns: 'number',
    name: 'Add 1 month to an existing instance',
    impls: {
      date: () => {
        const a = MS.map((m) => new Date(m));
        return (i) => {
          const d = new Date(a[i & MASK]);
          const day = d.getUTCDate();
          const target = d.getUTCMonth() + 1;
          const y = d.getUTCFullYear() + Math.floor(target / 12);
          const m = ((target % 12) + 12) % 12;
          const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          return Date.UTC(y, m, day < dim ? day : dim, d.getUTCHours(), d.getUTCMinutes(),
                          d.getUTCSeconds(), d.getUTCMilliseconds());
        };
      },
      chronoObj: (C) => { const a = MS.map((m) => new C.ChronoPlain(m)); return (i) => a[i & MASK].addMonths(1).wall; },
      dayjs: (D) => { const a = MS.map((m) => D.utc(m)); return (i) => a[i & MASK].add(1, 'month').valueOf(); },
      temporal: (T) => {
        const a = MS.map((m) => T.Instant.fromEpochMilliseconds(m).toZonedDateTimeISO('UTC'));
        return (i) => a[i & MASK].add({ months: 1 }).epochMilliseconds;
      },
    },
  },

  // ================================================================ FIELD ACCESS
  {
    id: 'fields', group: 'Field access', returns: 'number',
    name: 'Read all six calendar fields',
    note: 'y/m/d/h/m/s combined into one number. chronoFast does one civil conversion ' +
          'for all six; Date recomputes per getter.',
    impls: {
      date: () => (i) => {
        const d = new Date(MS[i & MASK]);
        return ((d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()) * 100000) +
               d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      },
      chronoRaw: (C) => (i) => {
        C.unpack(MS[i & MASK]);
        return ((C.cY * 10000 + C.cM * 100 + C.cD) * 100000) + C.cH * 3600 + C.cMi * 60 + C.cS;
      },
      chronoObj: (C) => (i) => {
        const p = new C.ChronoPlain(MS[i & MASK]);
        return ((p.year * 10000 + p.month * 100 + p.day) * 100000) + p.hour * 3600 + p.minute * 60 + p.second;
      },
      dayjs: (D) => (i) => {
        const d = D.utc(MS[i & MASK]);
        return ((d.year() * 10000 + (d.month() + 1) * 100 + d.date()) * 100000) +
               d.hour() * 3600 + d.minute() * 60 + d.second();
      },
      temporal: (T) => (i) => {
        const z = T.Instant.fromEpochMilliseconds(MS[i & MASK]).toZonedDateTimeISO('UTC');
        return ((z.year * 10000 + z.month * 100 + z.day) * 100000) + z.hour * 3600 + z.minute * 60 + z.second;
      },
    },
  },
  {
    id: 'day-of-week', group: 'Field access', returns: 'number',
    name: 'ISO day of week (1=Mon..7=Sun)',
    impls: {
      date: () => (i) => ((new Date(MS[i & MASK]).getUTCDay() + 6) % 7) + 1,
      chronoRaw: (C) => (i) => ((C.dayOfWeek(MS[i & MASK]) + 6) % 7) + 1,
      chronoObj: (C) => (i) => new C.ChronoPlain(MS[i & MASK]).dayOfWeek,
      dayjs: (D) => (i) => D.utc(MS[i & MASK]).isoWeekday(),
      temporal: (T) => (i) => T.Instant.fromEpochMilliseconds(MS[i & MASK]).toZonedDateTimeISO('UTC').dayOfWeek,
    },
  },
  {
    id: 'iso-week', group: 'Field access', returns: 'number',
    name: 'ISO-8601 week number',
    impls: {
      date: () => (i) => {
        const d = new Date(MS[i & MASK]);
        const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        const dow = (new Date(t).getUTCDay() + 6) % 7;
        const th = t + (3 - dow) * 86400000;
        const jan1 = Date.UTC(new Date(th).getUTCFullYear(), 0, 1);
        return Math.floor((th - jan1) / 604800000) + 1;
      },
      chronoRaw: (C) => (i) => C.isoWeek(MS[i & MASK]),
      chronoObj: (C) => (i) => new C.ChronoPlain(MS[i & MASK]).weekOfYear,
      dayjs: (D) => (i) => D.utc(MS[i & MASK]).isoWeek(),
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS[i & MASK]).toZonedDateTimeISO('UTC').toPlainDate().weekOfYear,
    },
  },

  // ================================================================ COMPARISON
  {
    id: 'sort', group: 'Bulk workloads', returns: 'number',
    name: `Sort ${SORT_N} instants`,
    note: 'One whole sort per operation, on a fresh copy each time.',
    impls: {
      date: () => { const src = SORT_MS.map((m) => new Date(m)); return () => { const a = src.slice(); a.sort((x, y) => x - y); return a[0].getTime() ^ a[a.length - 1].getTime(); }; },
      chronoRaw: (C) => { const src = SORT_MS.slice(); return () => { const a = src.slice(); a.sort((x, y) => x - y); return a[0] ^ a[a.length - 1]; }; },
      chronoObj: (C) => { const src = SORT_MS.map((m) => new C.ChronoInstant(m)); return () => { const a = src.slice(); a.sort(C.ChronoInstant.compare); return a[0].ms ^ a[a.length - 1].ms; }; },
      dayjs: (D) => { const src = SORT_MS.map((m) => D.utc(m)); return () => { const a = src.slice(); a.sort((x, y) => x.valueOf() - y.valueOf()); return a[0].valueOf() ^ a[a.length - 1].valueOf(); }; },
      temporal: (T) => {
        const src = SORT_MS.map((m) => T.Instant.fromEpochMilliseconds(m));
        return () => { const a = src.slice(); a.sort(T.Instant.compare); return a[0].epochMilliseconds ^ a[a.length - 1].epochMilliseconds; };
      },
    },
  },

  // ================================================================ REAL-LIFE PIPELINES
  {
    id: 'pipeline', group: 'Bulk workloads', returns: 'string',
    name: 'Pipeline: parse then +30 days then format',
    note: 'The classic "compute a due date from an API payload" round trip.',
    impls: {
      date: () => (i) => { const d = new Date(ISO_UTC[i & MASK]); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString(); },
      chronoRaw: (C) => (i) => C.toISO(C.addDays(C.parseISO(ISO_UTC[i & MASK]), 30)),
      dayjs: (D) => (i) => D.utc(ISO_UTC[i & MASK]).add(30, 'day').toISOString(),
      chronoObj: (C) => (i) => C.ChronoInstant.parse(ISO_UTC[i & MASK]).addDays(30).toISOString(),
      temporal: (T) => (i) =>
        T.Instant.from(ISO_UTC[i & MASK]).toZonedDateTimeISO('UTC').add({ days: 30 }).toInstant().toString(FSD),
    },
  },
  {
    id: 'bulk-bucket', group: 'Bulk workloads', returns: 'number',
    name: `Parse ${BULK} ISO strings and count per UTC day`,
    note: 'One full pass per operation. The realistic log/event aggregation workload.',
    impls: {
      date: () => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = new Date(BULK_ISO[k]).toISOString().slice(0, 10);
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
      chronoRaw: (C) => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = C.toISODate(C.parseISO(BULK_ISO[k]));
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
      chronoObj: (C) => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = C.ChronoInstant.parse(BULK_ISO[k]).toISODate();
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
      dayjs: (D) => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = D.utc(BULK_ISO[k]).format('YYYY-MM-DD');
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
      temporal: (T) => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = T.Instant.from(BULK_ISO[k]).toZonedDateTimeISO('UTC').toPlainDate().toString();
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
    },
  },

  // ================================================================ TIMEZONE
  {
    id: 'zone-offset', group: `Timezone (${TZ})`, returns: 'number',
    name: 'UTC offset for an instant',
    note: 'Scattered over two years, so chronoFast\'s interval cache gets no easy ride.',
    impls: {
      date: () => (i) => dtz.tzOffsetMs(TZ, MS_DST[i & MASK]),
      chronoRaw: (C) => (i) => C.offsetAt(TZ, MS_DST[i & MASK]),
      chronoObj: (C) => (i) => new C.ChronoZoned(MS_DST[i & MASK], TZ).offset,
      dayjs: (D) => (i) => D(MS_DST[i & MASK]).tz(TZ).utcOffset() * 60000,
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS_DST[i & MASK]).toZonedDateTimeISO(TZ).offsetNanoseconds / 1e6,
    },
  },
  {
    id: 'zone-format', group: `Timezone (${TZ})`, returns: 'string',
    name: 'Format instant as local ISO with offset',
    impls: {
      date: () => (i) => dtz.formatZoned(TZ, MS_DST[i & MASK]),
      chronoRaw: (C) => (i) => C.formatZoned(TZ, MS_DST[i & MASK]),
      dayjs: (D) => (i) => D(MS_DST[i & MASK]).tz(TZ).format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
      chronoObj: (C) => (i) => new C.ChronoZoned(MS_DST[i & MASK], TZ).toISOString(),
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS_DST[i & MASK]).toZonedDateTimeISO(TZ).toString(ZFMT),
    },
  },
  {
    id: 'zone-add-day', group: `Timezone (${TZ})`, returns: 'number',
    name: 'Add 1 local day across DST',
    note: 'A calendar day, not 24 hours: 23h or 25h when it crosses a transition.',
    impls: {
      date: () => (i) => dtz.addDaysZoned(TZ, MS_DST[i & MASK], 1),
      chronoRaw: (C) => (i) => C.addDaysZoned(TZ, MS_DST[i & MASK], 1),
      dayjs: (D) => (i) => D(MS_DST[i & MASK]).tz(TZ).add(1, 'day').valueOf(),
      chronoObj: (C) => (i) => new C.ChronoZoned(MS_DST[i & MASK], TZ).addDays(1).ms,
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS_DST[i & MASK]).toZonedDateTimeISO(TZ).add({ days: 1 }).epochMilliseconds,
    },
  },
  {
    id: 'zone-start-of-day', group: `Timezone (${TZ})`, returns: 'number',
    name: 'Local midnight for an instant',
    impls: {
      date: () => (i) => dtz.startOfDayZoned(TZ, MS_DST[i & MASK]),
      chronoRaw: (C) => (i) => C.startOfDayZoned(TZ, MS_DST[i & MASK]),
      chronoObj: (C) => (i) => new C.ChronoZoned(MS_DST[i & MASK], TZ).startOfDay().ms,
      dayjs: (D) => (i) => D(MS_DST[i & MASK]).tz(TZ).startOf('day').valueOf(),
      temporal: (T) => (i) =>
        T.Instant.fromEpochMilliseconds(MS_DST[i & MASK]).toZonedDateTimeISO(TZ).startOfDay().epochMilliseconds,
    },
  },
  {
    id: 'zone-bulk-bucket', group: `Timezone (${TZ})`, returns: 'number',
    name: `Bucket ${BULK} instants by LOCAL day`,
    note: 'Clustered over ~45 days, which is what event aggregation really looks like. ' +
          'This is where an offset cache earns its keep.',
    impls: {
      date: () => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = dtz.toZonedISODate(TZ, BULK_MS[k]);
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
      chronoRaw: (C) => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = C.toZonedISODate(TZ, BULK_MS[k]);
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
      chronoObj: (C) => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = new C.ChronoZoned(BULK_MS[k], TZ).toISODate();
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
      dayjs: (D) => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = D(BULK_MS[k]).tz(TZ).format('YYYY-MM-DD');
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
      temporal: (T) => () => {
        const m = new Map();
        for (let k = 0; k < BULK; k++) {
          const key = T.Instant.fromEpochMilliseconds(BULK_MS[k]).toZonedDateTimeISO(TZ).toPlainDate().toString();
          m.set(key, (m.get(key) || 0) + 1);
        }
        let acc = m.size;
        for (const [key, v] of m) acc = (ckStr(key, acc) + v) | 0;
        return acc;
      },
    },
  },
];
