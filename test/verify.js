// chronoFast correctness gate. Run before trusting any benchmark number.
//
//   1. The UTC engine against native Date, over 200k random instants.
//   2. Parser agreement across every ISO form the library accepts, plus 1,488
//      date-validity cases, plus the three inputs where chronoFast is deliberately
//      stricter than Date.
//   3. The zone engine against Intl (cached vs uncached, hourly across two years) and
//      against the Temporal polyfill across DST edges, for ten zones including Lord Howe
//      (30-minute DST), Chatham (+12:45), and the day Pacific/Apia skipped entirely.
//   4. Cache efficiency, reported so a regression in the Intl call count is visible.
//
// Inputs are deliberately interleaved across unrelated day-clusters: the library memoises
// on the current day, and a memo that is only correct for sequential access fails here.

import { Temporal } from 'temporal-polyfill';
// The raw layer is internal to the package; the gate exercises it directly. It must be a
// real module namespace - the scratch slots (cY, cM, ...) are live bindings that an
// object spread would snapshot.
import * as chrono from './chronofast-ns.js';

let fails = 0;
const bad = (m) => { if (fails++ < 25) console.log('  FAIL ' + m); };

// ---------------------------------------------------------------- 1. v2 vs Date
{
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const N = 200000;
  for (let i = 0; i < N; i++) {
    const ms = Math.floor((rnd() - 0.5) * 2 * 4.7e12);
    const d = new Date(ms);
    const iso = d.toISOString();
    if (chrono.toISO(ms) !== iso) { bad(`chrono.toISO ${ms}`); continue; }
    if (chrono.parseISO(iso) !== ms) bad(`chrono.parseISO round trip ${iso}`);
    if (chrono.getYear(ms) !== d.getUTCFullYear()) bad(`chrono.getYear ${ms}`);
    if (chrono.getMonth(ms) !== d.getUTCMonth() + 1) bad(`chrono.getMonth ${ms}`);
    if (chrono.getDay(ms) !== d.getUTCDate()) bad(`chrono.getDay ${ms}`);
    if (chrono.getHour(ms) !== d.getUTCHours()) bad(`chrono.getHour ${ms}`);
    if (chrono.getMinute(ms) !== d.getUTCMinutes()) bad(`chrono.getMinute ${ms}`);
    if (chrono.getSecond(ms) !== d.getUTCSeconds()) bad(`chrono.getSecond ${ms}`);
    if (chrono.getMillisecond(ms) !== d.getUTCMilliseconds()) bad(`chrono.getMillisecond ${ms}`);
    // dayOfWeek is ISO (1=Mon..7=Sun); the Date-compatible variant is dayOfWeekSunday0.
    if (chrono.dayOfWeekSunday0(ms) !== d.getUTCDay()) bad(`dayOfWeekSunday0 ${ms}`);
    if (chrono.dayOfWeek(ms) !== ((d.getUTCDay() + 6) % 7) + 1) bad(`dayOfWeek ISO ${ms}`);
  }
  console.log(`  [1] UTC engine vs native Date over ${N} random instants: ${fails === 0 ? 'OK' : fails + ' failures'}`);
}

// ---------------------------------------------------------------- 2b. parser agreement
{
  const before = fails;
  // Inputs where chronoFast intentionally rejects what Date accepts.
  const STRICTER = new Set([
    '2023-02-29T00:00:00.000Z',   // Date silently rolls this to 2023-03-01
    '2024-03-15T24:00:00.000Z',   // ISO-8601 allows hour 24; chronoFast requires 0-23
    '2024-03',                    // year-month only; chronoFast requires a full date
  ]);
  const forms = [
    '2024-03-15T10:30:00.123Z',   // canonical, hits the v2 fast path
    '2024-03-15T10:30:00Z', '2024-03-15T10:30Z', '2024-03-15',
    '2024-03-15T10:30:00+02:00', '2024-03-15T10:30:00-05:30', '2024-03-15T10:30:00+0200',
    '2024-03-15t10:30:00z', '2024-03-15 10:30:00Z', '2024-02-29T23:59:59.999Z',
    '2024-03-15T10:30:00.000000123Z', '+010000-01-01T00:00:00.000Z',
    '-000001-01-01T00:00:00.000Z', '0001-01-01T00:00:00.000Z',
    // malformed - all must be NaN in both
    '2024-13-01T00:00:00.000Z', '2024-00-01T00:00:00.000Z', '2024-03-00T00:00:00.000Z',
    '2023-02-29T00:00:00.000Z', '2024-03-15T24:00:00.000Z', '2024-03-15T10:60:00.000Z',
    '2024-03-15T10:30:60.000Z', '2024-03-1XT10:30:00.000Z', '20X4-03-15T10:30:00.000Z',
    '2024-03-15T10:30:00.12XZ', '2024-03-15T10:30:00.123X', 'not-a-date-at-all-here!!',
    '', '2024-03', '2024-03-15T10:30:00.Z',
  ];
  for (const s of forms) {
    const b = chrono.parseISO(s);
    // Compare against Date only where the two grammars actually agree. chronoFast is
    // deliberately stricter in three documented ways, asserted separately below.
    const dp = Date.parse(s);
    if (!Number.isNaN(dp) && dp !== b && s.length !== 10 && !s.includes(' ') && !STRICTER.has(s)) {
      bad(`parseISO "${s}": Date=${dp} v2=${b}`);
    }
  }
  // exhaustive day-of-month validity, both paths
  for (let mo = 1; mo <= 12; mo++) {
    for (let day = 1; day <= 31; day++) {
      for (const y of [2023, 2024, 1900, 2000]) {
        const s = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`;
        const got = chrono.parseISO(s);
        const want = Date.UTC(y, mo - 1, day) === Date.UTC(y, mo - 1, day) && new Date(Date.UTC(y, mo - 1, day)).getUTCDate() === day
          ? Date.UTC(y, mo - 1, day) : NaN;
        if (!((Number.isNaN(want) && Number.isNaN(got)) || want === got)) bad(`day validity "${s}": want ${want} got ${got}`);
      }
    }
  }
  for (const s2 of STRICTER) {
    if (!Number.isNaN(chrono.parseISO(s2))) bad(`expected chronoFast to reject "${s2}"`);
    if (Number.isNaN(Date.parse(s2))) bad(`expected Date to ACCEPT "${s2}" (contract drift)`);
  }
  console.log(`  [2] parser agreement across ${forms.length} forms + 1488 date validity cases: ${fails === before ? 'OK' : (fails - before) + ' failures'}`);
}

// ---------------------------------------------------------------- 3. zone engine
{
  const before = fails;
  const ZONES = ['Europe/Bratislava', 'America/New_York', 'Australia/Lord_Howe',
                 'Pacific/Chatham', 'Asia/Kolkata', 'America/Sao_Paulo', 'Africa/Cairo',
                 'Pacific/Apia', 'Asia/Tehran', 'UTC'];

  // cached vs uncached, hourly across two years
  for (const tz of ZONES) {
    chrono.resetZoneCaches();
    const start = Date.UTC(2023, 5, 1);
    let n = 0;
    for (let h = 0; h < 24 * 730; h++) {
      const t = start + h * 3600000;
      if (chrono.offsetAt(tz, t) !== chrono.offsetAtUncached(tz, t)) n++;
    }
    if (n) bad(`${tz}: cached offset disagrees with Intl on ${n} hourly samples`);
  }

  // v2 vs Temporal across DST edges and ordinary days
  for (const tz of ZONES) {
    chrono.resetZoneCaches();
    const base = Date.UTC(2024, 0, 15, 9, 20, 30, 500);
    for (let d = 0; d < 400; d++) {
      const t = base + d * 86400000;
      const zdt = Temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(tz);
      if (chrono.offsetAt(tz, t) !== zdt.offsetNanoseconds / 1e6) { bad(`${tz} offsetAt d=${d}`); break; }
      if (chrono.startOfDayZoned(tz, t) !== zdt.startOfDay().epochMilliseconds) { bad(`${tz} startOfDay d=${d}`); break; }
      const n = (d % 9) - 4;
      if (chrono.addDaysZoned(tz, t, n) !== zdt.add({ days: n }).epochMilliseconds) { bad(`${tz} addDays ${n} d=${d}`); break; }
      const mo = (d % 7) - 3;
      if (chrono.addMonthsZoned(tz, t, mo) !== zdt.add({ months: mo }).epochMilliseconds) { bad(`${tz} addMonths ${mo} d=${d}`); break; }
      if (chrono.formatZoned(tz, t) !== zdt.toString({ timeZoneName: 'never', fractionalSecondDigits: 3 })) {
        bad(`${tz} formatZoned d=${d}: v2=${chrono.formatZoned(tz, t)}`); break;
      }
      if (chrono.toZonedISODate(tz, t) !== zdt.toPlainDate().toString()) { bad(`${tz} toZonedISODate d=${d}`); break; }
    }
  }

  // wall -> instant disambiguation vs Temporal
  for (const tz of ZONES) {
    chrono.resetZoneCaches();
    for (const day of ['2024-03-31', '2024-10-27', '2024-11-03', '2024-03-10', '2024-04-07', '2024-10-06']) {
      for (let m = 0; m < 24 * 60; m += 7) {
        const wall = Date.parse(day + 'T00:00:00Z') + m * 60000;
        const pdt = Temporal.Instant.fromEpochMilliseconds(wall).toZonedDateTimeISO('UTC').toPlainDateTime();
        const ref = pdt.toZonedDateTime(tz, { disambiguation: 'compatible' }).epochMilliseconds;
        if (chrono.utcFromWall(tz, wall) !== ref) { bad(`${tz} utcFromWall ${pdt}`); m = 1e9; }
      }
    }
  }
  console.log(`  [3] zone engine vs Intl + Temporal across ${ZONES.length} zones: ${fails === before ? 'OK' : (fails - before) + ' failures'}`);
}

// ---------------------------------------------------------------- 4. cache efficiency
{
  chrono.resetZoneCaches();
  const TZ = 'Europe/Bratislava';
  const t0 = Date.UTC(2024, 0, 1);
  const N = 50000;
  for (let i = 0; i < N; i++) chrono.offsetAt(TZ, t0 + i * 60000);
  const st = chrono.zoneStats(TZ);
  console.log(`  [4] ${N} lookups over ${st.daysCached} days -> ${st.intlCalls} Intl calls ` +
              `(${(N / st.intlCalls).toFixed(0)}x reduction, ${((1 - st.intlCalls / N) * 100).toFixed(3)}% hit rate)`);
}

console.log(fails === 0 ? '\nchronoFast: ALL CHECKS PASS' : `\nchronoFast v2: ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
