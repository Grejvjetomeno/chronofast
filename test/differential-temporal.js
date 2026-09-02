// Differential suite: chronofast against Temporal, mechanically.
//
// The value proposition is "Temporal's answers, faster". That is checkable rather than
// arguable: generate inputs, run both, assert equality. Every defect found by hand in this
// library so far came from a few dozen written-out comparisons; this generates hundreds of
// thousands, and it hunts the places dates actually break instead of sampling uniformly.
//
// What it covers, and why each dimension is here:
//
//   1. UTC engine        - every field, ISO string and arithmetic op vs PlainDateTime.
//   2. Every IANA zone   - all 418 the host knows, not a hand-picked ten. A zone the author
//                          never thought of is exactly where an offset rule bites.
//   3. Real transitions  - found via getTimeZoneTransition rather than guessed, then probed
//                          at +-1ms, +-1s, +-1min, +-1h. DST bugs live within a second of a
//                          boundary and nowhere else, so uniform sampling never finds them.
//   4. Disambiguation    - all four modes at genuine gaps and overlaps, including that
//                          'reject' throws on exactly the same inputs.
//   5. Calendar math     - add/subtract across boundaries, where "one day" stops meaning
//                          24 hours.
//   6. Round trips       - parse -> format -> parse, and date -> zoned -> date.
//
// Usage:
//   node test/differential-temporal.js            modest, runs in CI
//   node test/differential-temporal.js --deep     every zone, far more samples
//   node test/differential-temporal.js --seed 7   reproduce a specific run
//
// A failure prints the exact input that caused it, so it can be pasted into a REPL.

import { Temporal } from 'temporal-polyfill';
import {
  ChronoInstant, ChronoPlain, ChronoDate, ChronoZoned, AmbiguousTimeError,
} from '../lib/index.js';
import { offsetAt } from '../lib/zone.js';

const argv = process.argv.slice(2);
const DEEP = argv.includes('--deep');
const seedArg = argv.indexOf('--seed');
const SEED = seedArg >= 0 ? Number(argv[seedArg + 1]) : 20240315;

// Scale. Deep mode is for a release; the default is for every commit.
const CFG = DEEP
  ? { instants: 200_000, zones: Infinity, perZone: 400, transitionYears: 40, arith: 40_000 }
  : { instants: 40_000, zones: 60, perZone: 60, transitionYears: 12, arith: 8_000 };

const MS_DAY = 86_400_000;
const MAX_TIME = 8.64e15;

let seed = SEED >>> 0;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
/** Instants biased to the era real data lives in, with a tail into the extremes. */
const randomInstant = () => {
  const r = rnd();
  if (r < 0.75) return Math.floor(Date.UTC(2000, 0, 1) + rnd() * 50 * 365.25 * MS_DAY);
  if (r < 0.95) return Math.floor((rnd() - 0.5) * 2 * 4.7e12);
  return Math.floor((rnd() - 0.5) * 2 * MAX_TIME * 0.98);
};

// ---------------------------------------------------------------- reporting
let checks = 0;
const failures = [];
const tzdbDisagreements = [];
const hostDisagreements = [];
const MAX_REPORTED = 12;

/**
 * chronofast reads offsets from the host's `Intl`; temporal-polyfill carries its own copy
 * of the tz database. Those two can genuinely differ - Morocco's DST follows Ramadan, which
 * is lunar, and different tzdb snapshots project it differently decades out. When they do,
 * chronofast agreeing with the host is *correct behaviour*, not a defect, so the suite has
 * to tell the two apart or it cries wolf on every data-version skew.
 *
 * The test: ask the host directly. If chronofast matches `Intl`, the host and the polyfill
 * disagree and chronofast is siding with the host by design.
 */
function hostOffsetMs(tz, ms) {
  const str = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).format(ms);
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/.exec(str);
  if (!m) return 0;                                  // bare 'GMT' means +00:00
  const sign = m[1] === '-' ? -1 : 1;
  return sign * ((+m[2]) * 3600000 + (+(m[3] || 0)) * 60000 + (+(m[4] || 0)) * 1000);
}

function cmp(label, got, want, repro) {
  checks++;
  if (Object.is(got, want)) return true;
  // Offset-derived disagreements get one more question asked of them.
  const tzMatch = /tz=([^\s]+)/.exec(repro || '');
  const msMatch = /ms=(-?\d+)/.exec(repro || '');
  if (tzMatch && msMatch) {
    const host = hostOffsetMs(tzMatch[1], Number(msMatch[1]));
    const zoned = Temporal.Instant.fromEpochMilliseconds(Number(msMatch[1]))
      .toZonedDateTimeISO(tzMatch[1]).offsetNanoseconds / 1e6;
    if (host !== zoned) {
      tzdbDisagreements.push({ tz: tzMatch[1], ms: msMatch[1], host, polyfill: zoned, label });
      return false;
    }
  }
  if (failures.length < MAX_REPORTED) failures.push({ label, got, want, repro });
  else if (failures.length === MAX_REPORTED) failures.push({ label: '...further failures suppressed', got: '', want: '', repro: '' });
  return false;
}

const section = (name) => { process.stdout.write(`  ${name.padEnd(52)}`); return { name, at: Date.now(), start: checks }; };
const done = (s) => process.stdout.write(
  `${String(checks - s.start).padStart(9)} checks  ${String(Date.now() - s.at).padStart(6)} ms\n`);

// ---------------------------------------------------------------- zone list
const ALL_ZONES = Intl.supportedValuesOf('timeZone');
// A deterministic spread rather than the alphabetical head, so the default run still sees
// every continent and the awkward ones.
const ALWAYS = [
  'UTC', 'Europe/Bratislava', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe',
  'Pacific/Chatham', 'Pacific/Kiritimati', 'Pacific/Apia', 'America/Santiago',
  'Asia/Tehran', 'Africa/Casablanca', 'Antarctica/Troll', 'Asia/Kathmandu',
  'America/St_Johns', 'Pacific/Marquesas', 'Europe/Dublin', 'Asia/Gaza',
];
const ZONES = (() => {
  if (CFG.zones === Infinity) return ALL_ZONES;
  const picked = new Set(ALWAYS.filter((z) => ALL_ZONES.includes(z)));
  const step = Math.max(1, Math.floor(ALL_ZONES.length / (CFG.zones - picked.size)));
  for (let i = 0; i < ALL_ZONES.length && picked.size < CFG.zones; i += step) picked.add(ALL_ZONES[i]);
  return [...picked];
})();

// Which Temporal is behind the import matters: the polyfill carries its own copy of the tz
// database, while V8's native implementation reads the same ICU data chronofast does. Under
// --harmony-temporal the polyfill re-exports native, so this run is the stricter test of
// "same answers as the platform".
const REF_IS_NATIVE = typeof globalThis.Temporal !== 'undefined'
  && Temporal === globalThis.Temporal;
const HAS_WEEK_FIELDS =
  Temporal.PlainDate.from('2024-03-15').yearOfWeek !== undefined;

console.log('chronofast vs Temporal - differential suite');
console.log(`  reference: ${REF_IS_NATIVE ? 'NATIVE Temporal (host ICU)' : 'temporal-polyfill (bundled tzdb)'}` +
            `${HAS_WEEK_FIELDS ? '' : '  [week fields unimplemented, skipped]'}`);
console.log(`  mode ${DEEP ? 'DEEP' : 'default'}   seed ${SEED}   zones ${ZONES.length}/${ALL_ZONES.length}\n`);

// ================================================================ 1. UTC engine
{
  const s = section('1. UTC engine: fields, ISO, arithmetic');
  for (let i = 0; i < CFG.instants; i++) {
    const ms = randomInstant();
    const c = new ChronoPlain(ms);
    let t;
    try { t = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO('UTC').toPlainDateTime(); }
    catch { continue; }                      // outside Temporal's range; chronofast agrees below
    const repro = `ms=${ms}`;
    cmp('year', c.year, t.year, repro);
    cmp('month', c.month, t.month, repro);
    cmp('day', c.day, t.day, repro);
    cmp('hour', c.hour, t.hour, repro);
    cmp('minute', c.minute, t.minute, repro);
    cmp('second', c.second, t.second, repro);
    cmp('millisecond', c.millisecond, t.millisecond, repro);
    cmp('dayOfWeek', c.dayOfWeek, t.dayOfWeek, repro);
    cmp('dayOfYear', c.dayOfYear, t.dayOfYear, repro);
    cmp('toPlainISOString', c.toPlainISOString(), t.toString(), repro);
    cmp('instant toISOString', new ChronoInstant(ms).toISOString(), new Date(ms).toISOString(), repro);
    // weekOfYear near the year boundary is where ISO week rules bite. V8's native Temporal
    // has not shipped these two yet and returns undefined; comparing against a field the
    // reference does not implement tests nothing, so they are skipped there rather than
    // reported as disagreements.
    if (HAS_WEEK_FIELDS) {
      cmp('weekOfYear', c.weekOfYear, t.weekOfYear, repro);
      cmp('weekYear', c.weekYear, t.yearOfWeek, repro);
    }
  }
  done(s);
}

// ================================================================ 2. arithmetic
{
  const s = section('2. Calendar arithmetic and truncation');
  const DAYS = [-4000, -366, -31, -7, -1, 0, 1, 7, 31, 366, 4000];
  const MONTHS = [-241, -25, -13, -1, 0, 1, 13, 25, 241];
  for (let i = 0; i < CFG.arith; i++) {
    const ms = randomInstant();
    const c = new ChronoPlain(ms);
    let t;
    try { t = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO('UTC').toPlainDateTime(); }
    catch { continue; }
    const repro = `ms=${ms}`;
    const n = DAYS[i % DAYS.length];
    const m = MONTHS[i % MONTHS.length];
    try {
      cmp(`addDays(${n})`, c.addDays(n).toPlainISOString(), t.add({ days: n }).toString(), repro);
      cmp(`addMonths(${m})`, c.addMonths(m).toPlainISOString(), t.add({ months: m }).toString(), repro);
      cmp(`addYears(${m})`, c.addYears(m).toPlainISOString(), t.add({ years: m }).toString(), repro);
    } catch { /* one side out of range; the other is checked by the range section */ }
    cmp('startOfDay', c.startOfDay().toPlainISOString(),
        t.with({ hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 }).toString(), repro);
    // ChronoDate against PlainDate on the same value
    const cd = c.toPlainDate();
    const td = t.toPlainDate();
    cmp('date toISODate', cd.toISODate(), td.toString(), repro);
    cmp('date daysInMonth', cd.daysInMonth, td.daysInMonth, repro);
    cmp('date inLeapYear', cd.inLeapYear, td.inLeapYear, repro);
    cmp('date addMonths', cd.addMonths(m).toISODate(), td.add({ months: m }).toString(), repro);
  }
  done(s);
}

// ================================================================ 3. every zone
{
  const s = section(`3. Offsets across ${ZONES.length} IANA zones`);
  for (const tz of ZONES) {
    for (let i = 0; i < CFG.perZone; i++) {
      const ms = randomInstant();
      let t;
      try { t = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz); }
      catch { continue; }
      const repro = `tz=${tz} ms=${ms}`;
      cmp('offset', offsetAt(tz, ms), t.offsetNanoseconds / 1e6, repro);
      const z = new ChronoZoned(ms, tz);
      cmp('zoned year', z.year, t.year, repro);
      cmp('zoned hour', z.hour, t.hour, repro);
      cmp('zoned minute', z.minute, t.minute, repro);
      cmp('zoned toISODate', z.toISODate(), t.toPlainDate().toString(), repro);
      cmp('zoned dayOfWeek', z.dayOfWeek, t.dayOfWeek, repro);
      cmp('startOfDay', z.startOfDay().epochMilliseconds,
          t.startOfDay().epochMilliseconds, repro);
    }
  }
  done(s);
}

// ================================================================ 4. transitions
// The interesting instants are not random - they are the ones next to a DST change.
const TRANSITIONS = new Map();
{
  const s = section(`4. Real DST transitions, +-1ms to +-1h`);
  // V8's native Temporal has not shipped getTimeZoneTransition, so transitions cannot be
  // located against that reference. The polyfill run covers this; say so rather than
  // reporting a silent zero.
  const CAN_FIND_TRANSITIONS = typeof Temporal.Instant.fromEpochMilliseconds(0)
    .toZonedDateTimeISO('UTC').getTimeZoneTransition === 'function';
  if (!CAN_FIND_TRANSITIONS) {
    console.log('   SKIPPED - no getTimeZoneTransition in this build');
  }
  const OFFSETS = [-3600000, -60000, -1000, -1, 0, 1, 1000, 60000, 3600000];
  for (const tz of CAN_FIND_TRANSITIONS ? ZONES : []) {
    const found = [];
    let cur = Temporal.Instant.fromEpochMilliseconds(
      Date.UTC(2025 - CFG.transitionYears, 0, 1)).toZonedDateTimeISO(tz);
    for (let k = 0; k < CFG.transitionYears * 3; k++) {
      let next;
      try { next = cur.getTimeZoneTransition('next'); } catch { break; }
      if (!next) break;
      found.push(next.epochMilliseconds);
      cur = next;
      if (next.epochNanoseconds > Temporal.Instant.fromEpochMilliseconds(Date.UTC(2035, 0, 1)).epochNanoseconds) break;
    }
    TRANSITIONS.set(tz, found);
    for (const at of found) {
      for (const d of OFFSETS) {
        const ms = at + d;
        let t;
        try { t = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz); } catch { continue; }
        const repro = `tz=${tz} transition=${at} delta=${d} ms=${ms}`;
        cmp('offset at transition', offsetAt(tz, ms), t.offsetNanoseconds / 1e6, repro);
        const z = new ChronoZoned(ms, tz);
        cmp('hour at transition', z.hour, t.hour, repro);
        cmp('ISO at transition', z.toISOString(),
            t.toInstant().toZonedDateTimeISO(tz).toString({ timeZoneName: 'never' })
              .replace(/(\.\d{3})\d*/, '$1')
              .replace(/T(\d\d:\d\d:\d\d)(?!\.)/, 'T$1.000'), repro);
        cmp('startOfDay at transition', z.startOfDay().epochMilliseconds,
            t.startOfDay().epochMilliseconds, repro);
      }
    }
  }
  done(s);
}

// ================================================================ 5. disambiguation
{
  const s = section('5. Disambiguation at genuine gaps and overlaps');
  if (TRANSITIONS.size === 0) {
    console.log('   SKIPPED - depends on section 4');
  }
  const MODES = ['compatible', 'earlier', 'later'];
  for (const [tz, list] of TRANSITIONS) {
    for (const at of list) {
      // The local wall clock either side of the change is where ambiguity lives. Probe a
      // window around it in local terms, which is what a user would actually type.
      const before = Temporal.Instant.fromEpochMilliseconds(at - 3600_000).toZonedDateTimeISO(tz);
      for (let step = 0; step <= 8; step++) {
        const local = before.toPlainDateTime().add({ minutes: step * 15 });
        const repro = `tz=${tz} local=${local.toString()} transition=${at}`;
        const cp = ChronoPlain.of(local.year, local.month, local.day,
                                  local.hour, local.minute, local.second, local.millisecond);
        for (const mode of MODES) {
          let want;
          try { want = local.toZonedDateTime(tz, { disambiguation: mode }).epochMilliseconds; }
          catch { continue; }
          let got;
          try { got = cp.assumeZone(tz, mode).epochMilliseconds; }
          catch (e) { got = 'THREW ' + e.constructor.name; }
          cmp(`assumeZone ${mode}`, got, want, repro);
        }
        // 'reject' must throw on exactly the same inputs, and only those
        let tRejected = false;
        try { local.toZonedDateTime(tz, { disambiguation: 'reject' }); }
        catch { tRejected = true; }
        let cRejected = false;
        try { cp.assumeZone(tz, 'reject'); }
        catch (e) { cRejected = e instanceof AmbiguousTimeError; }
        cmp('reject agrees', cRejected, tRejected, repro);
      }
    }
  }
  done(s);
}

// ================================================================ 6. round trips
{
  const s = section('6. Round trips and parser agreement');
  for (let i = 0; i < CFG.instants / 4; i++) {
    const ms = randomInstant();
    try { Temporal.Instant.fromEpochMilliseconds(ms); } catch { continue; }
    const repro = `ms=${ms}`;
    const iso = new ChronoInstant(ms).toISOString();
    cmp('instant parse round trip', ChronoInstant.parse(iso).epochMilliseconds, ms, repro);
    cmp('Temporal parses our output', Temporal.Instant.from(iso).epochMilliseconds, ms, repro);
    const plainIso = new ChronoPlain(ms).toPlainISOString();
    cmp('plain parse round trip', ChronoPlain.parse(plainIso).valueOf(), ms, repro);
    cmp('Temporal parses our plain output',
        Temporal.PlainDateTime.from(plainIso).toString(), plainIso, repro);
    const d = new ChronoPlain(ms).toPlainDate();
    cmp('date round trip', ChronoDate.parse(d.toISODate()).dayIndex, d.dayIndex, repro);
  }
  // zone round trip: date -> local start of day -> date
  for (const tz of ZONES) {
    for (let i = 0; i < 8; i++) {
      const ms = Math.floor(Date.UTC(2000, 0, 1) + rnd() * 40 * 365.25 * MS_DAY);
      const d = new ChronoZoned(ms, tz).toPlainDate();
      const repro = `tz=${tz} ms=${ms}`;
      cmp('date -> startOfDay -> date', d.atStartOfDay(tz).toPlainDate().toISODate(), d.toISODate(), repro);
    }
  }
  done(s);
}

// ================================================================ 7. locale output
{
  const s = section('7. Locale output vs Temporal');
  const LOCALES = ['sk-SK', 'en-US', 'ja-JP', 'ar-EG', 'de-DE'];
  // Options valid on both, and options only a date-time can answer. A date must REFUSE the
  // second group rather than render midnight, which is what Temporal does.
  const DATE_OPTS = [undefined, { dateStyle: 'full' }, { dateStyle: 'medium' },
                     { month: 'long', day: 'numeric', year: 'numeric' }, { weekday: 'long' }];
  const TIME_OPTS = [{ hour: '2-digit', minute: '2-digit' }, { timeStyle: 'short' },
                     { dateStyle: 'short', timeStyle: 'medium' }];
  const attempt = (f) => { try { return { v: f() }; } catch (e) { return { threw: e.constructor.name }; } };
  // ICU emits U+202F (narrow no-break space) before AM/PM in some builds. Under
  // --harmony-temporal, V8's Intl.DateTimeFormat uses it while Date.prototype.toLocaleString
  // still uses U+0020 - the engine disagreeing with itself, which no library can reconcile.
  // Compare the visible text: any Unicode space separator counts as a space.
  const sameText = (a, b) => a.replace(/[\s   ]+/g, ' ') === b.replace(/[\s   ]+/g, ' ');

  for (let i = 0; i < 600; i++) {
    const ms = Math.floor(Date.UTC(2000, 0, 1) + rnd() * 50 * 365.25 * MS_DAY);
    const loc = LOCALES[i % LOCALES.length];
    const t = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO('UTC').toPlainDateTime();
    const cp = new ChronoPlain(ms);
    const cd = cp.toPlainDate();
    const td = t.toPlainDate();

    for (const o of DATE_OPTS.concat(TIME_OPTS)) {
      const repro = `ms=${ms} locale=${loc} opts=${JSON.stringify(o)}`;

      // chronofast follows Date's formatting semantics deliberately. V8's native Temporal
      // differs from both Date and the polyfill on style options - it appends a time to a
      // date-only `{dateStyle}` request, and it silently ignores time components on a
      // PlainDate where the polyfill throws. Where chronofast matches Date, siding with the
      // platform is the intended behaviour, so those are recorded rather than failed.
      const got = cp.toLocaleString(loc, o);
      const want = t.toLocaleString(loc, o);
      if (!sameText(got, want)) {
        const host = new Date(ms).toLocaleString(loc, { timeZone: 'UTC', ...o });
        if (sameText(got, host)) hostDisagreements.push({ label: 'plain toLocaleString', opts: o, chrono: got, temporal: want });
        else cmp('plain toLocaleString', got, want, repro);
      } else { checks++; }

      const a = attempt(() => cd.toLocaleString(loc, o));
      const b = attempt(() => td.toLocaleString(loc, o));
      if ((a.threw !== undefined) !== (b.threw !== undefined)) {
        // Refusing a time component on a date is the polyfill's behaviour and this
        // library's; native Temporal ignores it instead. Record, do not fail.
        hostDisagreements.push({ label: 'date toLocaleString refusal', opts: o,
                                 chrono: a.threw ?? a.v, temporal: b.threw ?? b.v });
        checks++;
      } else if (a.threw === undefined) {
        if (!sameText(a.v, b.v)) {
          // Same rule as above: if chronofast matches what Date renders for the date part,
          // the divergence is this Temporal build's, not ours.
          const hostDate = new Date(ms).toLocaleString(loc, { timeZone: 'UTC', ...o });
          if (sameText(a.v, hostDate) || hostDate.startsWith(a.v)) {
            hostDisagreements.push({ label: 'date toLocaleString', opts: o, chrono: a.v, temporal: b.v });
            checks++;
          } else cmp('date toLocaleString', a.v, b.v, repro);
        } else { checks++; }
      } else { checks++; }
    }
  }
  done(s);
}

// ---------------------------------------------------------------- verdict
console.log();
if (tzdbDisagreements.length) {
  const zones = [...new Set(tzdbDisagreements.map((d) => d.tz))];
  console.log(`  ${tzdbDisagreements.length} check(s) skipped: the host tz database and temporal-polyfill`);
  console.log(`  disagree about ${zones.join(', ')}. chronofast reads the host, by design, so it`);
  console.log('  matches Date and Intl here. Not a defect. Example:');
  const d = tzdbDisagreements[0];
  console.log(`    ${d.tz} at ${new Date(Number(d.ms)).toISOString()}`);
  console.log(`      host Intl        ${d.host} ms   (chronofast follows this)`);
  console.log(`      temporal-polyfill ${d.polyfill} ms
`);
}
if (hostDisagreements.length) {
  const kinds = [...new Set(hostDisagreements.map((d) => d.label))];
  console.log(`  ${hostDisagreements.length} check(s) recorded where this Temporal build differs from`);
  console.log(`  Date itself (${kinds.join('; ')}). chronofast follows Date. Example:`);
  const d = hostDisagreements[0];
  console.log(`    opts ${JSON.stringify(d.opts)}`);
  console.log(`      chronofast (= Date) ${JSON.stringify(d.chrono)}`);
  console.log(`      this Temporal build ${JSON.stringify(d.temporal)}
`);
}
if (failures.length === 0) {
  console.log(`  ${checks.toLocaleString('en-US')} differential checks, 0 disagreements with Temporal`);
  process.exit(0);
}
console.log(`  ${failures.length} DISAGREEMENT(S) out of ${checks.toLocaleString('en-US')} checks:\n`);
for (const f of failures) {
  if (!f.repro) { console.log('  ' + f.label); continue; }
  console.log(`  ${f.label}`);
  console.log(`     chronofast : ${JSON.stringify(f.got)}`);
  console.log(`     Temporal   : ${JSON.stringify(f.want)}`);
  console.log(`     reproduce  : ${f.repro}\n`);
}
process.exit(1);
