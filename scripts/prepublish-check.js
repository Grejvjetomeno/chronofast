// Refuse to publish something broken. Runs from `prepublishOnly`, so `npm publish`
// cannot proceed unless every one of these passes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const fail = [];
const warn = [];
const ok = [];
const check = (cond, msg) => (cond ? ok : fail).push(msg);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// --- build output present and complete ---
check(existsSync('lib'), 'lib/ exists');
for (const f of ['index.js', 'index.d.ts', 'core.js', 'core.d.ts', 'zone.js', 'zone.d.ts']) {
  check(existsSync(`lib/${f}`), `lib/${f} built`);
}
check(!readdirSync('lib').some((f) => f.endsWith('.map')),
      'no source maps in the published build');

// --- browser bundles present and minified ---
check(existsSync('browser/chronofast.min.js'), 'browser/chronofast.min.js built');
check(existsSync('browser/chronofast.global.min.js'), 'browser/chronofast.global.min.js built');
if (existsSync('browser/chronofast.min.js')) {
  const b = readFileSync('browser/chronofast.min.js', 'utf8');
  check(b.length < readFileSync('lib/core.js', 'utf8').length,
        'browser bundle is actually minified (smaller than one unminified module)');
  check(b.startsWith('/*!'), 'browser bundle keeps its licence banner');
}

// --- every exports path resolves ---
for (const [sub, def] of Object.entries(pkg.exports || {})) {
  if (typeof def !== 'object') continue;
  for (const [cond, p] of Object.entries(def)) {
    check(existsSync(p.replace('./', '')), `exports["${sub}"].${cond} -> ${p}`);
  }
}

// --- the public surface is what we say it is ---
const api = await import('../lib/index.js');
const EXPECTED = ['AmbiguousTimeError', 'ChronoDate', 'ChronoInstant', 'ChronoPlain', 'ChronoZoned',
                  'InvalidInstantError', 'Now', 'UnknownTimeZoneError'];
const actual = Object.keys(api).sort();
check(JSON.stringify(actual) === JSON.stringify(EXPECTED),
      `public exports are exactly [${EXPECTED.join(', ')}]` +
      (JSON.stringify(actual) === JSON.stringify(EXPECTED) ? '' : ` - got [${actual.join(', ')}]`));
for (const leaked of ['parseISO', 'toISO', 'addDays', 'offsetAt', 'civilFromDays']) {
  check(!(leaked in api), `raw layer stays internal (${leaked})`);
}

// --- it actually works ---
const { ChronoInstant } = api;
const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
check(t.toISOString() === '2024-03-15T10:30:00.000Z', 'round trip');
// Calendar arithmetic lives on ChronoPlain and ChronoZoned; a moment has no calendar.
check(api.ChronoPlain.parse('2024-01-31T00:00:00').addMonths(1).toISODate() === '2024-02-29',
      'end-of-month clamp is leap-aware');
const z = t.inZone('Europe/Bratislava');
check(z.toISOString() === '2024-03-15T11:30:00.000+01:00', 'zoned formatting');
const dst = ChronoInstant.fromEpochMs(Date.parse('2024-03-30T12:00:00Z')).inZone('Europe/Bratislava');
check((dst.addDays(1).epochMilliseconds - dst.epochMilliseconds) / 3600000 === 23,
      'a calendar day across spring-forward is 23 hours');

// Now must read the LOCAL clock, not UTC - the whole reason the namespace exists.
const { Now, ChronoPlain } = api;

// The split is the point: neither type may carry the other's capabilities.
const probeInstant = ChronoInstant.parse('2024-03-15T10:30:00.000Z');
const probePlain = ChronoPlain.parse('2024-03-15T10:30');
for (const f of ['year', 'month', 'hour', 'dayOfWeek', 'addMonths', 'startOfDay']) {
  check(!(f in probeInstant), `ChronoInstant has no ${f}`);
}
for (const f of ['epochMilliseconds', 'toDate', 'inZone', 'toISOString']) {
  check(!(f in probePlain), `ChronoPlain has no ${f}`);
}
const wall = new Date().toLocaleString('sv-SE', { timeZone: Now.timeZoneId() }).replace(' ', 'T');
check(Now.plainDateTimeISO().toPlainISOString().slice(0, 16) === wall.slice(0, 16),
      'Now.plainDateTimeISO() reads the local wall clock');
check(Now.plainDateISO().toISODate() === wall.slice(0, 10), 'Now.plainDateISO() is the local date');
check(!Now.plainDateTimeISO().toPlainISOString().includes('Z'), 'toPlainISOString() emits no Z');

// --- no runtime dependencies ---
// --- the parsing doors must fail CLOSED ---
// This is a safety property, not a style preference. `parse` once returned a NaN-carrying
// instance on malformed input, and NaN makes both `a >= b` and `a < b` false - so a bad
// timestamp took the else-branch of every downstream comparison instead of surfacing.
// Anything that reintroduces that must not reach npm.
{
  const M = await import('../lib/index.js');
  const MALFORMED = ['not-a-date', '', '2026-02-30T00:00:00', '2026-13-01T00:00:00'];
  const throwsRange = (f) => {
    try { f(); return false; } catch (e) { return e instanceof RangeError; }
  };
  check(MALFORMED.every((b) => throwsRange(() => M.ChronoInstant.parse(b))),
        'ChronoInstant.parse throws RangeError on malformed input');
  check(MALFORMED.every((b) => throwsRange(() => M.ChronoPlain.parse(b))),
        'ChronoPlain.parse throws RangeError on malformed input');
  check(MALFORMED.every((b) => throwsRange(() => M.ChronoZoned.parse(b, 'UTC'))),
        'ChronoZoned.parse throws RangeError on malformed input');
  check(throwsRange(() => M.ChronoInstant.fromDate(new Date(NaN))),
        'ChronoInstant.fromDate throws on an invalid Date');
  check(MALFORMED.every((b) => M.ChronoInstant.tryParse(b) === null),
        'ChronoInstant.tryParse returns null rather than throwing');
  check(MALFORMED.every((b) => M.ChronoPlain.tryParse(b) === null &&
                               M.ChronoZoned.tryParse(b, 'UTC') === null),
        'ChronoPlain and ChronoZoned expose the same tryParse door');
  check(M.ChronoInstant.parse('2024-03-15T10:30:00.123Z').toISOString() ===
        '2024-03-15T10:30:00.123Z',
        'well-formed input still parses unchanged');

  // ChronoDate must stay a DATE. If it ever grows a time getter it has become a
  // ChronoPlain wearing a different name, and the type-level guarantee is gone.
  const d = M.ChronoDate.parse('2024-03-15');
  check(['hour', 'minute', 'second', 'addHours', 'epochMilliseconds', 'toDate']
          .every((f) => !(f in d)),
        'ChronoDate carries no time-of-day capability');
  check(d.toISODate() === '2024-03-15' && d.addDays(7).toISODate() === '2024-03-22' &&
        M.ChronoDate.parse('2024-01-31').addMonths(1).toISODate() === '2024-02-29',
        'ChronoDate arithmetic clamps like Temporal.PlainDate');
  check(throwsRange(() => M.ChronoDate.parse('2024-03-15T10:30:00Z')),
        'ChronoDate rejects a Z designator, as Temporal.PlainDate does');
  check(M.ChronoDate.parse('2024-03-15T23:30:00-05:00').toISODate() === '2024-03-15',
        'ChronoDate keeps the date as written when an offset is present');
  check(M.ChronoPlain.parse('2024-03-15T23:30:00-05:00').toPlainISOString() ===
        '2024-03-15T23:30:00',
        'ChronoPlain keeps the wall clock as written rather than shifting it');

  // toLocaleString must be DEFINED, not inherited. Object.prototype.toLocaleString exists
  // on every object and delegates to toString(), so `typeof x.toLocaleString === 'function'`
  // is true even when the method is missing - the failure is silent and renders ISO text
  // into a localised UI.
  for (const [name, obj] of [
    ['ChronoInstant', M.ChronoInstant.parse('2026-09-02T12:30:00Z')],
    ['ChronoPlain', M.ChronoPlain.parse('2026-09-02T14:30:00')],
    ['ChronoZoned', M.ChronoInstant.parse('2026-09-02T12:30:00Z').inZone('Europe/Bratislava')],
    ['ChronoDate', M.ChronoDate.parse('2026-09-02')],
  ]) {
    const proto = Object.getPrototypeOf(obj);
    const own = Object.getOwnPropertyNames(proto);
    check(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].every((m) => own.includes(m)),
          `${name} defines toLocale* rather than inheriting Object.prototype's`);
    check(obj.toLocaleString('sk-SK') !== obj.toString(),
          `${name}.toLocaleString actually localises instead of echoing the ISO string`);
  }
}

check(Object.keys(pkg.dependencies || {}).length === 0, 'zero runtime dependencies');

// --- metadata ---
for (const f of ['name', 'version', 'description', 'license', 'repository', 'author']) {
  check(pkg[f], `package.json has ${f}`);
}
check(!pkg.private, 'package is not marked private');

// --- git hygiene (warn only; publishing from a dirty tree is legal, just unwise) ---
try {
  const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (dirty) warn.push(`working tree has ${dirty.split('\n').length} uncommitted change(s)`);
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  if (branch && branch !== 'main') warn.push(`publishing from branch "${branch}", not main`);
} catch { /* not a git checkout */ }

// --- what npm would actually ship ---
try {
  const packed = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const entry = Array.isArray(packed) ? packed[0] : packed;
  if (entry) {
    const names = entry.files.map((f) => f.path);
    check(names.every((n) => n.startsWith('lib/') || n.startsWith('browser/') || n === 'package.json' ||
                             /^(README|LICENSE)/i.test(n)),
          `tarball contains only lib/ + browser/ + metadata (${entry.entryCount} files, ${(entry.unpackedSize / 1024).toFixed(1)} kB)`);
    check(!names.some((n) => n.startsWith('src/') || n.startsWith('bench/') || n.startsWith('test/')),
          'no source, bench or test files in the tarball');
  }
} catch { warn.push('could not run `npm pack --dry-run` to inspect the tarball'); }

for (const m of ok) console.log(`  ok    ${m}`);
for (const m of warn) console.log(`  warn  ${m}`);
for (const m of fail) console.log(`  FAIL  ${m}`);
console.log(`\n  ${ok.length} passed, ${warn.length} warning(s), ${fail.length} failed`);
if (fail.length) { console.error('\n  publish blocked\n'); process.exit(1); }
console.log('  ready to publish\n');
