// Is the immutable class slow because of the ALLOCATION, or because addDays() delegates
// through two imported function frames (addDays -> unsafeEpochMs)? Inline the arithmetic
// into the method, keep immutability, and see which it was.
import { measure } from './runner.js';
import { addDays as rawAddDays } from '../lib/core.js';
import { ChronoInstant } from '../lib/index.js';

const variant = process.argv[process.argv.indexOf('--variant') + 1];
const MS = [];
{ let s = 12345;
  for (let i = 0; i < 1024; i++) { s = (Math.imul(s,1103515245)+12345)&0x7fffffff;
    MS.push(Date.UTC(2024,0,1)+Math.floor((s/0x7fffffff)*7.3e10)); } }

// same shape as ChronoInstant, but the arithmetic is written in the method body
class InlinedInstant {
  constructor(ms) { this.ms = ms; }
  addDays(n) { return new InlinedInstant(this.ms + n * 86_400_000); }
}
class MutableInstant {
  constructor(ms) { this.ms = ms; }
  addDays(n) { this.ms += n * 86_400_000; return this; }
}

const V = {
  'current-immutable': () => { const a = MS.map((m) => new ChronoInstant(m)); return (i) => a[i & 1023].addDays(7).ms; },
  'inlined-immutable': () => { const a = MS.map((m) => new InlinedInstant(m)); return (i) => a[i & 1023].addDays(7).ms; },
  'mutable':           () => { const a = MS.map((m) => new MutableInstant(m)); return (i) => a[i & 1023].addDays(7).ms; },
  'raw-function':      () => (i) => rawAddDays(MS[i & 1023], 7),
};
const m = measure(V[variant](), { sampleMs: 700, warmupMs: 300 });
process.stdout.write(JSON.stringify({ variant, ns: +m.median.toFixed(3) }));
