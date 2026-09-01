// The `longOffset` fallback only runs on engines older than Chrome 95 / Firefox 91 /
// Safari 15.4 — which means it is the one path this machine never exercises, and therefore
// the one most likely to rot. Simulate such an engine by making the option throw, exactly
// as an older ECMA-402 implementation does, then check the fallback agrees with the fast
// path on the same instants.

const RealDTF = Intl.DateTimeFormat;

// Patch BEFORE importing the library, so its one-time capability probe sees the old engine.
class LegacyDTF extends RealDTF {
  constructor(locale, opts) {
    if (opts && opts.timeZoneName === 'longOffset') {
      throw new RangeError("Value longOffset out of range for Intl.DateTimeFormat options property timeZoneName");
    }
    super(locale, opts);
  }
}
Object.defineProperty(Intl, 'DateTimeFormat', { value: LegacyDTF, configurable: true, writable: true });

const legacy = await import('../lib/zone.js');

if (legacy.hasFastOffsetPath()) {
  console.log('  FAIL: capability probe did not notice the simulated old engine');
  process.exit(1);
}
console.log('  simulated engine without longOffset: fallback path active');

// Restore, then load a second, independent copy of the module on the modern path.
Object.defineProperty(Intl, 'DateTimeFormat', { value: RealDTF, configurable: true, writable: true });
const modern = await import('../lib/zone.js?modern');

if (!modern.hasFastOffsetPath()) {
  console.log('  SKIP: this engine has no longOffset either, cannot cross-check');
  process.exit(0);
}

const ZONES = ['Europe/Bratislava', 'America/New_York', 'Australia/Lord_Howe',
               'Pacific/Chatham', 'Asia/Kolkata', 'America/Sao_Paulo', 'Pacific/Apia', 'UTC'];

let fails = 0;
const bad = (m) => { if (fails++ < 15) console.log('  FAIL ' + m); };

for (const tz of ZONES) {
  // hourly across two years, plus minute resolution over the DST transition days
  const probes = [];
  const start = Date.UTC(2023, 5, 1);
  for (let h = 0; h < 24 * 730; h += 1) probes.push(start + h * 3600000);
  for (const anchor of [Date.UTC(2024, 2, 31), Date.UTC(2024, 9, 27), Date.UTC(2011, 11, 29)]) {
    for (let m = 0; m < 24 * 60; m += 1) probes.push(anchor + m * 60000);
  }

  let n = 0;
  for (const t of probes) {
    if (legacy.offsetAt(tz, t) !== modern.offsetAt(tz, t)) { n++; if (n === 1) bad(`${tz} offsetAt @${new Date(t).toISOString()}: legacy=${legacy.offsetAt(tz, t)} modern=${modern.offsetAt(tz, t)}`); }
  }
  if (n > 1) bad(`${tz}: ${n} offset disagreements in total`);

  // and the derived operations, which is what callers actually use
  for (let d = 0; d < 400; d++) {
    const t = Date.UTC(2024, 0, 15, 9, 20, 30, 500) + d * 86400000;
    if (legacy.formatZoned(tz, t) !== modern.formatZoned(tz, t)) { bad(`${tz} formatZoned d=${d}`); break; }
    if (legacy.startOfDayZoned(tz, t) !== modern.startOfDayZoned(tz, t)) { bad(`${tz} startOfDay d=${d}`); break; }
    const k = (d % 9) - 4;
    if (legacy.addDaysZoned(tz, t, k) !== modern.addDaysZoned(tz, t, k)) { bad(`${tz} addDays ${k} d=${d}`); break; }
  }
}

console.log(fails === 0
  ? `  legacy fallback agrees with the fast path across ${ZONES.length} zones (offsets, formatting, DST arithmetic)`
  : `  ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
