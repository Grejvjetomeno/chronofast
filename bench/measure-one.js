// Measure exactly ONE (scenario, contender) pair, then exit.
//
// This exists because measurement order was found to dominate the result: measure()'s
// `fn(idx++)` call sites go megamorphic as distinct closures pass through them, so the
// first contender measured in a process reads ~5.7x faster than identical code measured
// second. Giving each measurement its own closure does not help - V8 keeps the feedback
// keyed to the function literal. A fresh process is the only thing that reproduces the
// ground truth, so the parent spawns one of these per measurement.
//
// Prints a single JSON object on stdout. Anything else it emits is diagnostics on stderr.

import { SCENARIOS } from './scenarios.js';
import { measure, measureAlloc } from './runner.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const scenarioId = arg('--scenario');
const contenderId = arg('--contender');
const sampleMs = Number(arg('--sample-ms', 400));
const warmupMs = Number(arg('--warmup-ms', 150));
const withAlloc = argv.includes('--alloc');

const sc = SCENARIOS.find((s) => s.id === scenarioId);
if (!sc) { console.log(JSON.stringify({ status: 'error', message: `no scenario ${scenarioId}` })); process.exit(0); }

// Load only what this contender needs, so an unrelated polyfill never enters the process.
async function buildImpl() {
  if (contenderId === 'date') return sc.impls.date ? sc.impls.date() : null;

  if (contenderId === 'chrono-raw' || contenderId === 'chrono-obj') {
    const C = await import('./chronofast-ns.js');
    const f = contenderId === 'chrono-raw' ? sc.impls.chronoRaw : sc.impls.chronoObj;
    return f ? f(C) : null;
  }

  if (!sc.impls.temporal) return null;
  let T;
  if (contenderId === 'temporal-native') T = globalThis.Temporal;
  else if (contenderId === 'temporal-polyfill') T = (await import('temporal-polyfill')).Temporal;
  else if (contenderId === 'js-temporal') T = (await import('@js-temporal/polyfill')).Temporal;
  if (!T) return null;
  return sc.impls.temporal(T);
}

let out;
try {
  const fn = await buildImpl();
  if (typeof fn !== 'function') {
    out = { status: 'absent' };
  } else {
    let STR_SINK = '';
    const wrapped = sc.returns === 'string'
      ? (i) => { const v = fn(i); STR_SINK = v; return v.length; }
      : fn;

    const m = measure(wrapped, { sampleMs, warmupMs });
    out = {
      status: 'ok',
      opsPerSec: m.opsPerSec, medianNs: m.median, minNs: m.min,
      meanNs: m.mean, p99Ns: m.p99, rme: m.rme, samples: m.samples, iters: m.iters,
    };
    if (withAlloc && m.median < 20000) {
      const n = Math.max(200, Math.min(4000, Math.round(2e6 / m.median)));
      const a = measureAlloc(wrapped, 9, n);
      if (a) out.bytesPerOp = a.bytesPerOp;
    }
    if (STR_SINK === 'never-matches') process.stderr.write('unreachable');
  }
} catch (e) {
  out = { status: 'error', message: String((e && e.message) || e) };
}

process.stdout.write(JSON.stringify(out));
