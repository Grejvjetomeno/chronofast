// Merge the per-runtime result files into one Markdown report.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CONFIGS = [
  { tag: 'node', title: 'Node 24 (default)' },
  { tag: 'node-temporal', title: 'Node 24 with --harmony-temporal' },
  { tag: 'bun', title: 'Bun 1.3' },
];

// The headline tables carry v2; v1 gets its own before/after section further down.
const ORDER = ['date', 'chrono-raw', 'chrono-obj', 'temporal-native', 'temporal-polyfill', 'js-temporal'];
const SHORT = {
  'date': 'Date',
  'chrono-raw': 'chronoFast raw',
  'chrono-obj': 'chronoFast class',
  'temporal-native': 'Temporal native',
  'temporal-polyfill': 'temporal-polyfill',
  'js-temporal': '@js-temporal',
};
// Scenarios whose data is clustered in time, so the v2 memos actually get hits.

const root = new URL('../../', import.meta.url);
const loaded = [];
for (const c of CONFIGS) {
  const p = new URL(`results/${c.tag}.json`, root);
  if (existsSync(p)) loaded.push({ ...c, data: JSON.parse(readFileSync(p, 'utf8')) });
}
if (!loaded.length) { console.error('no result files found'); process.exit(1); }

const fmtOps = (v) => {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  if (v >= 1) return v.toFixed(0);
  return v.toFixed(2);
};
const fmtNs = (v) => {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' ms';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + ' µs';
  return v.toFixed(1) + ' ns';
};

function cell(e, best) {
  if (!e) return '&mdash;';
  if (e.status === 'unsupported') return 'n/a';
  if (e.status === 'error') return 'err';
  if (e.status === 'mismatch') return '**MISMATCH**';
  const o = fmtOps(e.opsPerSec);
  if (e.opsPerSec === best) return `**${o}**`;
  const factor = best / e.opsPerSec;
  const f = factor >= 100 ? factor.toFixed(0) : factor >= 10 ? factor.toFixed(0) : factor.toFixed(1);
  return `${o} <sub>${f}×</sub>`;
}

const out = [];
out.push('# Date handling in JavaScript: a real-life benchmark');
out.push('');
out.push('Native `Date` vs a purpose-built minimal library (`chronoFast`) vs native `Temporal` ' +
         'vs the two Temporal polyfills, measured on both Node and Bun.');
out.push('');

// ---------------------------------------------------------------- environment
out.push('## Environment');
out.push('');
out.push('| Runtime | Engine | Native `Temporal` | Contenders |');
out.push('|---|---|---|---|');
for (const c of loaded) {
  const d = c.data;
  out.push(`| ${d.runtime.name} ${d.runtime.version} | ${d.runtime.engine} | ` +
           `${d.nativeTemporal ? 'yes' : 'no'} | ${d.contenders.length} |`);
}
out.push('');
out.push('- `temporal-polyfill` 1.0.4, `@js-temporal/polyfill` 0.5.1');
out.push('- All timings are the **median** per-operation cost across many batched samples.');
out.push('- A `×` figure under a number is how many times slower it is than the fastest ' +
         'entry in that row.');
out.push('');

// ---------------------------------------------------------------- per runtime
for (const c of loaded) {
  const d = c.data;
  out.push(`## ${c.title}`);
  out.push('');
  if (d.tpIsNative) {
    out.push('> `temporal-polyfill` v1 re-exports native `Temporal` when it exists ' +
             '(`TP.Temporal === globalThis.Temporal`), so it is listed once here, as ' +
             '**Temporal native**.');
    out.push('');
  }
  const cols = ORDER.filter((id) => d.contenders.some((x) => x.id === id));

  let group = null;
  for (const sc of d.scenarios) {
    if (sc.group !== group) {
      group = sc.group;
      out.push('');
      out.push(`### ${group}`);
      out.push('');
      out.push('| Operation | ' + cols.map((id) => SHORT[id]).join(' | ') + ' |');
      out.push('|---|' + cols.map(() => '--:').join('|') + '|');
    }
    const oks = cols.map((id) => sc.entries[id]).filter((e) => e && e.status === 'ok');
    const best = oks.length ? Math.max(...oks.map((e) => e.opsPerSec)) : NaN;
    out.push(`| ${sc.name} | ` + cols.map((id) => cell(sc.entries[id], best)).join(' | ') + ' |');
  }
  out.push('');
}

// ---------------------------------------------------------------- allocation
const allocSrc = loaded.find((c) => c.data.scenarios.some((s) =>
  Object.values(s.entries).some((e) => e.bytesPerOp !== undefined)));
if (allocSrc) {
  out.push('## Allocation pressure (approximate bytes per operation)');
  out.push('');
  out.push(`Measured on ${allocSrc.data.runtime.name} ${allocSrc.data.runtime.version} by heap ` +
           'delta around short forced-GC windows. Directional, not exact — enough to ' +
           'separate "allocates nothing" from "allocates a dozen objects".');
  out.push('');
  const d = allocSrc.data;
  const cols = ORDER.filter((id) => d.contenders.some((x) => x.id === id));
  out.push('| Operation | ' + cols.map((id) => SHORT[id]).join(' | ') + ' |');
  out.push('|---|' + cols.map(() => '--:').join('|') + '|');
  for (const sc of d.scenarios) {
    const row = cols.map((id) => {
      const e = sc.entries[id];
      return e && e.bytesPerOp !== undefined ? `${e.bytesPerOp.toFixed(0)} B` : '&mdash;';
    });
    if (row.every((r) => r === '&mdash;')) continue;
    out.push(`| ${sc.name} | ` + row.join(' | ') + ' |');
  }
  out.push('');
}

// ---------------------------------------------------------------- node vs bun
const nodeC = loaded.find((c) => c.tag === 'node');
const bunC = loaded.find((c) => c.tag === 'bun');
if (nodeC && bunC) {
  out.push('## Node vs Bun, same code');
  out.push('');
  out.push('Ratio above 1 means Bun is faster.');
  out.push('');
  const cols = ORDER.filter((id) =>
    nodeC.data.contenders.some((x) => x.id === id) && bunC.data.contenders.some((x) => x.id === id));
  out.push('| Operation | ' + cols.map((id) => SHORT[id]).join(' | ') + ' |');
  out.push('|---|' + cols.map(() => '--:').join('|') + '|');
  for (let i = 0; i < nodeC.data.scenarios.length; i++) {
    const sn = nodeC.data.scenarios[i];
    const sb = bunC.data.scenarios.find((x) => x.id === sn.id);
    if (!sb) continue;
    const row = cols.map((id) => {
      const a = sn.entries[id], b = sb.entries[id];
      if (!a || !b || a.status !== 'ok' || b.status !== 'ok') return '&mdash;';
      const r = b.opsPerSec / a.opsPerSec;
      return (r >= 1 ? `**${r.toFixed(2)}×**` : `${r.toFixed(2)}×`);
    });
    out.push(`| ${sn.name} | ` + row.join(' | ') + ' |');
  }
  out.push('');
}

// ---------------------------------------------------------------- raw detail
out.push('## Per-operation median cost');
out.push('');
for (const c of loaded) {
  out.push(`<details><summary>${c.title}</summary>`);
  out.push('');
  const d = c.data;
  const cols = ORDER.filter((id) => d.contenders.some((x) => x.id === id));
  out.push('| Operation | ' + cols.map((id) => SHORT[id]).join(' | ') + ' |');
  out.push('|---|' + cols.map(() => '--:').join('|') + '|');
  for (const sc of d.scenarios) {
    out.push(`| ${sc.name} | ` + cols.map((id) => {
      const e = sc.entries[id];
      if (!e) return '&mdash;';
      if (e.status !== 'ok') return e.status === 'unsupported' ? 'n/a' : e.status;
      return fmtNs(e.medianNs);
    }).join(' | ') + ' |');
  }
  out.push('');
  out.push('</details>');
  out.push('');
}

writeFileSync(new URL('REPORT.md', root), out.join('\n'));
console.log('wrote REPORT.md  (' + loaded.map((c) => c.tag).join(', ') + ')');
