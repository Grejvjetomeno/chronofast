// Would a mutable class be "way faster"?
//
// The intuition is sound: an immutable method allocates a new wrapper per call, a mutable
// one does not. But chronofast's wrapper holds exactly one numeric field, and V8's escape
// analysis can often scalar-replace such an object entirely — in which case the allocation
// never happens and mutability buys nothing.
//
// Measured one variant per process (`--variant X`), because an in-process comparison of
// several closures is not trustworthy here: the shared call site goes megamorphic and
// penalises whatever runs second by ~5.7x.

import { measure } from './runner.js';
import { parseISO, toISO, addDays as rawAddDays, addMonths as rawAddMonths,
         startOfDay as rawStartOfDay } from '../lib/core.js';
import { ChronoInstant } from '../lib/index.js';

const variant = process.argv[process.argv.indexOf('--variant') + 1];
const scenario = process.argv[process.argv.indexOf('--scenario') + 1];

const MS = [];
{
  let s = 12345;
  for (let i = 0; i < 1024; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    MS.push(Date.UTC(2024, 0, 1) + Math.floor((s / 0x7fffffff) * 7.3e10));
  }
}

// ---- a mutable twin of ChronoInstant: methods write to `this` and return `this` ----
class MutableInstant {
  constructor(ms) { this.ms = ms; }
  static parse(s) { return new MutableInstant(parseISO(s)); }
  addDays(n) { this.ms += n * 86_400_000; return this; }
  addMonths(n) { this.ms = rawAddMonths(this.ms, n); return this; }
  startOfDay() { this.ms = rawStartOfDay(this.ms); return this; }
  toISOString() { return toISO(this.ms); }
}

const SCENARIOS = {
  // one operation, starting from a number: the object must be constructed either way
  'add-from-ms': {
    immutable: () => (i) => new ChronoInstant(MS[i & 1023]).addDays(7).ms,
    mutable: () => (i) => new MutableInstant(MS[i & 1023]).addDays(7).ms,
    raw: () => (i) => rawAddDays(MS[i & 1023], 7),
  },
  // one operation on an existing instance: this is where immutability actually allocates
  'add-on-instance': {
    immutable: () => { const a = MS.map((m) => new ChronoInstant(m)); return (i) => a[i & 1023].addDays(7).ms; },
    mutable: () => { const a = MS.map((m) => new MutableInstant(m)); return (i) => a[i & 1023].addDays(7).ms; },
    raw: () => (i) => rawAddDays(MS[i & 1023], 7),
  },
  // a chain: immutable allocates once per link, mutable allocates once total
  'chain-of-five': {
    immutable: () => (i) => new ChronoInstant(MS[i & 1023]).addDays(7).addMonths(1).addDays(-3).startOfDay().addDays(1).ms,
    mutable: () => (i) => new MutableInstant(MS[i & 1023]).addDays(7).addMonths(1).addDays(-3).startOfDay().addDays(1).ms,
    raw: () => (i) => rawAddDays(rawStartOfDay(rawAddDays(rawAddMonths(rawAddDays(MS[i & 1023], 7), 1), -3)), 1),
  },
  // a realistic pipeline including a string result
  'parse-add-format': {
    immutable: () => (i) => ChronoInstant.parse(ISO[i & 1023]).addDays(30).toISOString().length,
    mutable: () => (i) => MutableInstant.parse(ISO[i & 1023]).addDays(30).toISOString().length,
    raw: () => (i) => toISO(rawAddDays(parseISO(ISO[i & 1023]), 30)).length,
  },
};
const ISO = MS.map((m) => new Date(m).toISOString());

const fn = SCENARIOS[scenario][variant]();
const m = measure(fn, { sampleMs: 700, warmupMs: 300 });
process.stdout.write(JSON.stringify({
  scenario, variant, ns: +m.median.toFixed(3), ops: Math.round(m.opsPerSec), rme: +m.rme.toFixed(1),
}));
