// A minified bundle that is broken is worse than no bundle. Exercise the real API surface
// through the built artefacts, not through src.
import { readFileSync } from 'node:fs';

let fails = 0;
const bad = (m) => { fails++; console.log('  FAIL ' + m); };

const esm = await import('../browser/chronofast.min.js');
const EXPECTED = ['AmbiguousTimeError', 'ChronoDate', 'ChronoInstant', 'ChronoPlain', 'ChronoZoned',
                  'InvalidInstantError', 'Now', 'UnknownTimeZoneError'];
const got = Object.keys(esm).sort();
if (JSON.stringify(got) !== JSON.stringify(EXPECTED)) bad(`ESM exports: got [${got}]`);

const { ChronoInstant, ChronoPlain, ChronoZoned, UnknownTimeZoneError, Now } = esm;
const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
if (t.toISOString() !== '2024-03-15T10:30:00.000Z') bad('round trip');
const tp = ChronoPlain.parse('2024-03-15T10:30:00.123');
if (tp.year !== 2024 || tp.month !== 3 || tp.day !== 15) bad('fields');
if (ChronoPlain.parse('2024-01-31T00:00:00').addMonths(1).toISODate() !== '2024-02-29') bad('leap clamp');
const z = t.inZone('Europe/Bratislava');
if (z.toISOString() !== '2024-03-15T11:30:00.000+01:00') bad('zoned format');
const dst = ChronoZoned.fromEpochMs(Date.parse('2024-03-30T12:00:00Z'), 'Europe/Bratislava');
if ((dst.addDays(1).epochMilliseconds - dst.epochMilliseconds) / 3600000 !== 23) bad('DST day is 23h');
try { t.inZone('Not/AZone'); bad('bad zone did not throw'); }
catch (e) { if (!(e instanceof UnknownTimeZoneError)) bad('wrong error type: ' + e.constructor.name); }

// the split must survive minification: neither type may gain the other's capabilities
for (const f of ['year', 'hour', 'addMonths']) if (f in t) bad(`ChronoInstant kept ${f} after minification`);
for (const f of ['epochMilliseconds', 'toDate', 'inZone']) if (f in tp) bad(`ChronoPlain kept ${f} after minification`);
if (typeof Now.plainDateTimeISO !== 'function') bad('Now missing from the bundle');

// a wide differential sweep against Date, through the minified code
let seed = 99;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let n = 0;
for (let i = 0; i < 20000; i++) {
  const ms = Math.floor((rnd() - 0.5) * 2 * 4.7e12);
  if (ChronoInstant.fromEpochMs(ms).toISOString() !== new Date(ms).toISOString()) { n++; }
}
if (n) bad(`${n} ISO mismatches vs Date in the minified build`);

// The IIFE build declares `var chronofast = ...` at top level, which becomes a global
// property in a real <script>. Inside new Function it is function-scoped, so read it back
// by value rather than expecting it on an object.
const src = readFileSync('browser/chronofast.global.min.js', 'utf8');
const glob = new Function(src + ';\nreturn chronofast;')();
const gk = Object.keys(glob || {}).sort();
if (JSON.stringify(gk) !== JSON.stringify(EXPECTED)) bad(`IIFE global exports: got [${gk}]`);
if (!glob || glob.ChronoInstant.parse('2024-03-15T10:30:00.000Z').toISODate() !== '2024-03-15') {
  bad('IIFE build round trip');
}

console.log(fails === 0
  ? '  browser bundles: OK (ESM + IIFE, 20k differential samples vs Date)'
  : `  browser bundles: ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
