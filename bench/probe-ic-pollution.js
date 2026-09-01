// Does measurement ORDER change the result?
//
// measure() has three `fn(idx++)` call sites shared by every contender. As distinct
// closures flow through them the inline cache degrades monomorphic -> polymorphic ->
// megamorphic, so whoever is measured LAST may be penalised for no reason of its own.
//
// Eight targets below do byte-identical work through distinct function literals, so any
// spread between them is the harness, not the code.
//
// Run with --fresh to use a new measure() closure per measurement (the candidate fix),
// and with --solo=N to measure only target N in a clean process (ground truth).

const args = process.argv.slice(2);
const useFresh = args.includes('--fresh');
const solo = args.find((a) => a.startsWith('--solo='));

const DATA = new Array(1024);
for (let i = 0; i < 1024; i++) DATA[i] = (i * 2654435761) >>> 0;

// eight distinct literals, identical work
const T = [
  (i) => (DATA[i & 1023] * 3 + 1) | 0,
  (i) => (DATA[i & 1023] * 3 + 1) | 0,
  (i) => (DATA[i & 1023] * 3 + 1) | 0,
  (i) => (DATA[i & 1023] * 3 + 1) | 0,
  (i) => (DATA[i & 1023] * 3 + 1) | 0,
  (i) => (DATA[i & 1023] * 3 + 1) | 0,
  (i) => (DATA[i & 1023] * 3 + 1) | 0,
  (i) => (DATA[i & 1023] * 3 + 1) | 0,
];

const nowNs = () => process.hrtime.bigint();

// A factory, so each measurement can get its own closure - and therefore, if V8 allocates
// feedback per closure rather than per function literal, its own inline caches.
function makeMeasure() {
  return function measure(fn) {
    let sink = 0, idx = 0;
    let iters = 1;
    for (let g = 0; g < 40; g++) {
      const t0 = nowNs();
      for (let i = 0; i < iters; i++) sink ^= fn(idx++);
      const dt = Number(nowNs() - t0);
      if (dt >= 1_000_000 || iters >= (1 << 22)) break;
      iters = Math.min(iters * Math.min(Math.max(2, Math.ceil(1_000_000 / (dt || 1))), 100), 1 << 22);
    }
    const wEnd = nowNs() + 120_000_000n;
    while (nowNs() < wEnd) { for (let i = 0; i < iters; i++) sink ^= fn(idx++); }
    const s = [];
    const sEnd = nowNs() + 300_000_000n;
    while (s.length < 15 || nowNs() < sEnd) {
      const t0 = nowNs();
      for (let i = 0; i < iters; i++) sink ^= fn(idx++);
      s.push(Number(nowNs() - t0) / iters);
      if (s.length > 400) break;
    }
    s.sort((a, b) => a - b);
    if (sink === 42) console.log('');
    return s[s.length >> 1];
  };
}

const shared = makeMeasure();

if (solo) {
  const n = Number(solo.split('=')[1]);
  console.log(`solo target ${n}: ${makeMeasure()(T[n]).toFixed(3)} ns`);
} else {
  const label = useFresh ? 'FRESH measure closure per target' : 'SHARED measure closure (current harness)';
  console.log(`\n  ${label}`);
  console.log('  position  target   ns/op');
  console.log('  ' + '-'.repeat(30));
  const out = [];
  for (let p = 0; p < T.length; p++) {
    const m = useFresh ? makeMeasure() : shared;
    const ns = m(T[p]);
    out.push(ns);
    console.log(`  ${String(p + 1).padStart(5)}     ${String(p).padStart(5)}   ${ns.toFixed(3).padStart(7)}`);
  }
  const first = out[0], last = out[out.length - 1];
  const mn = Math.min(...out), mx = Math.max(...out);
  console.log(`\n  first ${first.toFixed(3)}  last ${last.toFixed(3)}   last/first ${(last / first).toFixed(2)}x`);
  console.log(`  spread across positions: ${((mx / mn - 1) * 100).toFixed(0)}%`);
}
