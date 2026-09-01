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

// --- every exports path resolves ---
for (const [sub, def] of Object.entries(pkg.exports || {})) {
  if (typeof def !== 'object') continue;
  for (const [cond, p] of Object.entries(def)) {
    check(existsSync(p.replace('./', '')), `exports["${sub}"].${cond} -> ${p}`);
  }
}

// --- the public surface is what we say it is ---
const api = await import('../lib/index.js');
const EXPECTED = ['AmbiguousTimeError', 'ChronoInstant', 'ChronoZoned',
                  'InvalidInstantError', 'UnknownTimeZoneError'];
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
check(ChronoInstant.parse('2024-01-31T00:00:00.000Z').addMonths(1).toISODate() === '2024-02-29',
      'end-of-month clamp is leap-aware');
const z = t.inZone('Europe/Bratislava');
check(z.toISOString() === '2024-03-15T11:30:00.000+01:00', 'zoned formatting');
const dst = ChronoInstant.fromEpochMs(Date.parse('2024-03-30T12:00:00Z')).inZone('Europe/Bratislava');
check((dst.addDays(1).epochMilliseconds - dst.epochMilliseconds) / 3600000 === 23,
      'a calendar day across spring-forward is 23 hours');

// --- no runtime dependencies ---
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
    check(names.every((n) => n.startsWith('lib/') || n === 'package.json' ||
                             /^(README|LICENSE)/i.test(n)),
          `tarball contains only lib/ + metadata (${entry.entryCount} files, ${(entry.unpackedSize / 1024).toFixed(1)} kB)`);
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
