// Hand-rolled measurement harness. Zero dependencies, identical code on Node and Bun.
//
// What it does about the usual ways a JS microbenchmark lies:
//
//   DEAD-CODE ELIMINATION - every measured call feeds a sink that is XOR-accumulated
//     and printed at the end, so neither V8 nor JSC can prove the work is unobservable.
//   VARYING INPUT - the measured function receives a monotonically increasing index and
//     is expected to read from a dataset with it, so nothing is loop-invariant or
//     constant-foldable, and branch predictors get a realistic mix.
//   TIMER RESOLUTION - iterations are batched until a batch takes >= 1ms, so the ~50ns
//     cost of hrtime is under 0.01% of a sample.
//   JIT WARMUP - a timed warmup phase runs before any sample is kept, letting the
//     function tier up to optimised code and letting inline caches settle.
//   GC AND OS NOISE - many samples are collected and the MEDIAN is the headline number.
//     p99 is reported alongside so allocation-driven tail latency stays visible.

const nowNs = () => process.hrtime.bigint();

// Measured once: the smallest non-zero step this clock can report.
const TIMER_NS = (() => {
  let best = Infinity;
  for (let i = 0; i < 500; i++) {
    const a = nowNs(); let b = nowNs();
    while (b === a) b = nowNs();
    const d = Number(b - a);
    if (d > 0 && d < best) best = d;
  }
  return Number.isFinite(best) ? best : 100;
})();

export const timerResolutionNs = TIMER_NS;

function stats(samples) {
  const s = samples.slice().sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  let sq = 0;
  for (let i = 0; i < n; i++) { const d = s[i] - mean; sq += d * d; }
  const sd = Math.sqrt(sq / (n - 1 || 1));
  const rme = mean > 0 ? (1.96 * (sd / Math.sqrt(n)) / mean) * 100 : 0;
  return {
    median: s[n >> 1],
    min: s[0],
    mean,
    p99: s[Math.min(n - 1, Math.ceil(n * 0.99) - 1)],
    rme,
    samples: n,
  };
}

export function measure(fn, opts = {}) {
  const {
    targetBatchNs = 1_000_000,
    warmupMs = 150,
    sampleMs = 400,
    minSamples = 15,
    maxSamples = 500,
    maxTotalMs = 3500,
  } = opts;

  let sink = 0;
  let idx = 0;

  // --- prime before calibrating ---
  // The FIRST call can cost thousands of times the steady state: a cold zone cache has to
  // construct an Intl.DateTimeFormat (~56us here) and probe days. If that lands in the
  // calibration batch, the calibrator concludes one iteration already exceeds the target
  // and leaves iters at 1 - which then measures timer quantisation rather than the code.
  // Capped by time so a genuinely slow operation is not primed fifty times.
  const primeEnd = nowNs() + 25_000_000n;
  for (let i = 0; i < 50 && nowNs() < primeEnd; i++) sink ^= fn(idx++);

  // --- calibrate batch size ---
  let iters = 1;
  for (let guard = 0; guard < 40; guard++) {
    const t0 = nowNs();
    for (let i = 0; i < iters; i++) sink ^= fn(idx++);
    const dt = Number(nowNs() - t0);
    if (dt >= targetBatchNs || iters >= (1 << 22)) break;
    const scale = dt > 0 ? Math.max(2, Math.ceil((targetBatchNs / dt) * 1.2)) : 16;
    iters = Math.min(iters * Math.min(scale, 100), 1 << 22);
  }

  // --- warmup ---
  const wEnd = nowNs() + BigInt(Math.round(warmupMs * 1e6));
  while (nowNs() < wEnd) { for (let i = 0; i < iters; i++) sink ^= fn(idx++); }

  // --- sample ---
  const samples = [];
  const sEnd = nowNs() + BigInt(Math.round(sampleMs * 1e6));
  // Hard ceiling so a single very slow operation cannot stall the whole run; three
  // samples is the floor below which the median stops meaning anything.
  const hardEnd = nowNs() + BigInt(Math.round(maxTotalMs * 1e6));
  while (samples.length < maxSamples && (samples.length < minSamples || nowNs() < sEnd)) {
    if (samples.length >= 3 && nowNs() > hardEnd) break;
    const t0 = nowNs();
    for (let i = 0; i < iters; i++) sink ^= fn(idx++);
    samples.push(Number(nowNs() - t0) / iters);
  }

  const st = stats(samples);
  // A batch shorter than ~50 timer ticks cannot be trusted: the reading is dominated by
  // clock granularity, not by the work. Surfaced rather than silently reported.
  const batchNs = st.median * iters;
  const lowResolution = batchNs < TIMER_NS * 50;
  return { ...st, opsPerSec: 1e9 / st.median, iters, batchNs, lowResolution, sink };
}

// Approximate bytes allocated per operation, via heap deltas around a short run.
// Deliberately conservative: several trials, GC-disturbed (negative or absurd) trials
// discarded, median of what survives. Directional, not exact - enough to separate
// "allocates nothing" from "allocates a dozen objects".
export function measureAlloc(fn, trials = 9, n = 4000) {
  const gc = typeof globalThis.gc === 'function'
    ? globalThis.gc
    : (typeof globalThis.Bun !== 'undefined' ? () => globalThis.Bun.gc(true) : null);
  if (!gc) return null;

  let sink = 0;
  for (let i = 0; i < n * 2; i++) sink ^= fn(i);        // settle inline caches first

  const out = [];
  let idx = 0;
  for (let t = 0; t < trials; t++) {
    gc(); gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < n; i++) sink ^= fn(idx++);
    const after = process.memoryUsage().heapUsed;
    const per = (after - before) / n;
    if (per >= 0 && per < 100000) out.push(per);
  }
  if (out.length < 3) return null;
  out.sort((a, b) => a - b);
  return { bytesPerOp: out[out.length >> 1], trials: out.length, sink };
}

export function fmtOps(v) {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return v.toFixed(0);
}

export function fmtNs(v) {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' ms';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + ' µs';
  if (v >= 1) return v.toFixed(1) + ' ns';
  return v.toFixed(3) + ' ns';
}
