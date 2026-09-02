// Benchmark driver.
//
// Two properties this harness insists on:
//
//   NOTHING IS TIMED UNTIL IT IS PROVED CORRECT. Every contender is compared against a
//   reference on 200 spread indices first. A disagreement is reported as MISMATCH and
//   excluded - a fast wrong answer is not a result.
//
//   EVERY MEASUREMENT GETS A FRESH PROCESS. measure()'s call sites go megamorphic as
//   distinct closures pass through them, and an identical function measured second in a
//   process reads ~5.7x slower than the same function measured first. Order, not code,
//   was dominating the numbers. Each (scenario, contender) is now spawned into its own
//   node/bun process via measure-one.js, which reproduces the single-measurement ground
//   truth. It costs wall-clock; it buys numbers that mean something.

import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.js';
import { fmtOps, fmtNs } from './runner.js';
import * as TP from 'temporal-polyfill';
import * as JT from '@js-temporal/polyfill';
import * as CHRONO from './chronofast-ns.js';
import DAYJS from './dayjs-ns.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

const TAG = arg('--tag', 'run');
const SAMPLE_MS = arg('--sample-ms', '400');
const WARMUP_MS = arg('--warmup-ms', '150');
const WITH_ALLOC = has('--alloc');

const isBun = typeof globalThis.Bun !== 'undefined';
const runtime = isBun
  ? { engine: 'JavaScriptCore', name: 'Bun', version: globalThis.Bun.version }
  : { engine: 'V8 ' + process.versions.v8.split('-')[0], name: 'Node', version: process.versions.node };

const nativeTemporal = typeof globalThis.Temporal !== 'undefined';
// temporal-polyfill v1 re-exports native Temporal when it exists, so under
// --harmony-temporal the two are the same object. Listing both would measure one thing twice.
const tpIsNative = nativeTemporal && TP.Temporal === globalThis.Temporal;

const CONTENDERS = [
  { id: 'date', label: 'Native Date', kind: 'date' },
  { id: 'chrono-raw', label: 'chronoFast (raw)', kind: 'chronoRaw', lib: CHRONO },
  { id: 'chrono-obj', label: 'chronoFast (class)', kind: 'chronoObj', lib: CHRONO },
];
if (nativeTemporal) CONTENDERS.push({ id: 'temporal-native', label: 'Temporal (native)', kind: 'temporal', T: globalThis.Temporal });
if (!tpIsNative) CONTENDERS.push({ id: 'temporal-polyfill', label: 'temporal-polyfill', kind: 'temporal', T: TP.Temporal });
CONTENDERS.push({ id: 'js-temporal', label: '@js-temporal/polyfill', kind: 'temporal', T: JT.Temporal });
CONTENDERS.push({ id: 'dayjs', label: 'Day.js', kind: 'dayjs', lib: DAYJS });

console.log('='.repeat(78));
console.log(`  ${runtime.name} ${runtime.version}  (${runtime.engine})`);
if (tpIsNative) console.log('  NOTE: temporal-polyfill re-exports native Temporal here; listed once.');
console.log(`  native Temporal: ${nativeTemporal ? 'YES' : 'no'}   |  contenders: ${CONTENDERS.length}` +
            `   |  scenarios: ${SCENARIOS.length}`);
console.log(`  each measurement runs in its own process (${SCENARIOS.length * CONTENDERS.length} spawns)`);
console.log('='.repeat(78));

// ---------------------------------------------------------------- correctness gate
// Runs in-process: it is a comparison of return values, not of timings, so inline-cache
// state cannot distort it.
function buildImpl(sc, c) {
  const f = sc.impls[c.kind];
  if (!f) return null;
  try {
    if (c.kind === 'temporal') return f(c.T);
    if (c.kind === 'chronoRaw' || c.kind === 'chronoObj' || c.kind === 'dayjs') return f(c.lib);
    return f();
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

const VERIFY_IDX = [];
for (let i = 0; i < 200; i++) VERIFY_IDX.push(i * 7 + (i % 13));

const CHILD = fileURLToPath(new URL('./measure-one.js', import.meta.url));
const EXEC = isBun ? 'bun' : process.execPath;
const EXEC_ARGS = isBun ? [] : process.execArgv;   // carry --expose-gc / --harmony-temporal

function measureInChild(scenarioId, contenderId) {
  const a = [...EXEC_ARGS, CHILD, '--scenario', scenarioId, '--contender', contenderId,
             '--sample-ms', SAMPLE_MS, '--warmup-ms', WARMUP_MS];
  if (WITH_ALLOC) a.push('--alloc');
  const r = spawnSync(EXEC, a, { encoding: 'utf8', maxBuffer: 8 << 20 });
  if (r.error) return { status: 'error', message: String(r.error.message) };
  const txt = (r.stdout || '').trim();
  if (!txt) return { status: 'error', message: `child produced no output (exit ${r.status}) ${(r.stderr || '').slice(0, 160)}` };
  try { return JSON.parse(txt); }
  catch { return { status: 'error', message: `unparseable child output: ${txt.slice(0, 160)}` }; }
}

const results = [];
let totalMismatch = 0;
let lowRes = 0;

for (const sc of SCENARIOS) {
  const built = CONTENDERS.map((c) => ({ c, r: buildImpl(sc, c) }))
    .map(({ c, r }) => (typeof r === 'function' ? { c, fn: r } : r && r.error ? { c, fn: null, error: r.error } : { c, fn: null, absent: true }));

  const heavy = sc.id === 'bulk-bucket' || sc.id === 'zone-bulk-bucket' || sc.id === 'sort';
  const idxs = heavy ? [0, 1] : VERIFY_IDX;
  const ref = built.find((b) => b.fn && b.c.kind === 'date') || built.find((b) => b.fn);
  let refVals = null;
  if (ref) { try { refVals = idxs.map((i) => ref.fn(i)); } catch (e) { ref.error = String((e && e.message) || e); } }

  for (const b of built) {
    if (!b.fn || b === ref || !refVals) continue;
    try {
      for (let k = 0; k < idxs.length; k++) {
        const got = b.fn(idxs[k]);
        if (got === undefined) { b.unsupported = true; break; }
        if (got !== refVals[k]) { b.mismatch = { idx: idxs[k], want: String(refVals[k]), got: String(got) }; break; }
      }
    } catch (e) { b.error = String((e && e.message) || e); }
  }

  const row = { id: sc.id, name: sc.name, group: sc.group, note: sc.note || null, returns: sc.returns, entries: {} };
  console.log('\n' + sc.group + '  ' + String.fromCharCode(0x2502) + '  ' + sc.name);
  if (sc.note) console.log('   ' + sc.note);

  for (const b of built) {
    const id = b.c.id;
    const pad = b.c.label.padEnd(22);
    if (b.absent) { continue; }
    if (b.error) { row.entries[id] = { status: 'error', message: b.error }; console.log(`   ${pad} ERROR  ${b.error}`); continue; }
    if (b.unsupported) { row.entries[id] = { status: 'unsupported' }; console.log(`   ${pad} n/a    API not available`); continue; }
    if (b.mismatch) {
      totalMismatch++;
      row.entries[id] = { status: 'mismatch', ...b.mismatch };
      console.log(`   ${pad} MISMATCH at i=${b.mismatch.idx}: want ${b.mismatch.want}, got ${b.mismatch.got}`);
      continue;
    }
    const e = measureInChild(sc.id, id);
    row.entries[id] = e;
    if (e.status === 'ok') {
      console.log(`   ${pad} ${fmtOps(e.opsPerSec).padStart(9)} ops/s   ${fmtNs(e.medianNs).padStart(10)}/op   ` +
                  `p99 ${fmtNs(e.p99Ns).padStart(10)}   +-${e.rme.toFixed(1)}%` +
                  (e.bytesPerOp !== undefined ? `   ~${e.bytesPerOp.toFixed(0)} B/op` : '') +
                  (e.lowResolution ? '   << LOW RESOLUTION, do not trust' : ''));
      if (e.lowResolution) lowRes++;
    } else {
      console.log(`   ${pad} ${e.status.toUpperCase()}  ${e.message || ''}`);
    }
  }

  const oks = Object.entries(row.entries).filter(([, e]) => e.status === 'ok');
  if (oks.length) {
    const best = Math.max(...oks.map(([, e]) => e.opsPerSec));
    for (const [, e] of oks) e.relative = e.opsPerSec / best;
  }
  results.push(row);
}

mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../results/${TAG}.json`, import.meta.url), JSON.stringify({
  runtime, nativeTemporal, tpIsNative, tag: TAG,
  isolation: 'process-per-measurement',
  contenders: CONTENDERS.map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
  scenarios: results,
  config: { sampleMs: Number(SAMPLE_MS), warmupMs: Number(WARMUP_MS), alloc: WITH_ALLOC },
}, null, 2));

console.log('\n' + '='.repeat(78));
console.log(totalMismatch === 0 ? '  all contenders agreed on every scenario'
                                : `  ${totalMismatch} MISMATCH(es) - excluded from the numbers`);
if (lowRes) console.log(`  ${lowRes} measurement(s) flagged LOW RESOLUTION - batch shorter than 50 timer ticks`);
console.log(`  wrote results/${TAG}.json`);
console.log('='.repeat(78));
