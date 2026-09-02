// Build the self-contained HTML report from the result JSON files.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const CONFIGS = [
  { tag: 'node', label: 'Node 24', sub: 'default' },
  { tag: 'node-temporal', label: 'Node 24', sub: '--harmony-temporal' },
  { tag: 'bun', label: 'Bun 1.3', sub: 'JavaScriptCore' },
];

// Charts carry v2; v1 appears only in the before/after section.
const ORDER = ['date', 'chrono-raw', 'chrono-obj', 'temporal-native', 'temporal-polyfill', 'js-temporal', 'dayjs'];

const SHORT = {
  'date': 'Date',
  'chrono-raw': 'chronoFast raw',
  'chrono-obj': 'chronoFast class',
  'temporal-native': 'Temporal native',
  'temporal-polyfill': 'temporal-polyfill',
  'js-temporal': '@js-temporal',
  'dayjs': 'Day.js',
};
// Fixed slot per bar position; validated as a sequence in both modes.
const SLOT = { 'date': 1, 'chrono-raw': 2, 'chrono-obj': 3, 'temporal-native': 4, 'temporal-polyfill': 4, 'js-temporal': 5, 'dayjs': 2 };

const runs = [];
for (const c of CONFIGS) {
  const p = new URL(`results/${c.tag}.json`, root);
  if (!existsSync(p)) continue;
  const d = JSON.parse(readFileSync(p, 'utf8'));
  runs.push({
    tag: c.tag, label: c.label, sub: c.sub,
    runtime: d.runtime, nativeTemporal: d.nativeTemporal, tpIsNative: !!d.tpIsNative,
    contenders: d.contenders.map((x) => x.id),
    scenarios: d.scenarios.map((s) => ({
      id: s.id, name: s.name, group: s.group, note: s.note,
      e: Object.fromEntries(Object.entries(s.entries).map(([k, v]) => [k,
        v.status === 'ok'
          ? { o: +v.opsPerSec.toPrecision(5), n: +v.medianNs.toPrecision(5), b: v.bytesPerOp !== undefined ? Math.round(v.bytesPerOp) : null }
          : { s: v.status }])),
    })),
  });
}
if (!runs.length) { console.error('no results'); process.exit(1); }

const DATA = { runs, SHORT, SLOT, ORDER };

const html = `<title>Four Ways to Add a Day</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{
  color-scheme: light;
  --page:#EDEFEF; --card:#FBFCFC; --sunk:#E4E8E8;
  --ink:#0F1416; --ink-2:#525C5F; --ink-3:#828C8E;
  --rule:#D8DDDD; --rule-2:#C4CBCB;
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4;
  --good:#1a7f4f; --warn:#9a6400;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme: dark;
    --page:#111516; --card:#191E1F; --sunk:#0C1011;
    --ink:#EEF2F2; --ink-2:#A6B0B2; --ink-3:#727B7D;
    --rule:#2A3132; --rule-2:#3A4344;
    --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181;
    --good:#4cb383; --warn:#d0a03c;
  }
}
:root[data-theme="dark"]{
  color-scheme: dark;
  --page:#111516; --card:#191E1F; --sunk:#0C1011;
  --ink:#EEF2F2; --ink-2:#A6B0B2; --ink-3:#727B7D;
  --rule:#2A3132; --rule-2:#3A4344;
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181;
  --good:#4cb383; --warn:#d0a03c;
}

*{box-sizing:border-box}
body{
  margin:0; background:var(--page); color:var(--ink);
  font-family:"IBM Plex Sans",system-ui,-apple-system,Segoe UI,sans-serif;
  font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1140px;margin:0 auto;padding:40px 24px 88px}
.mono{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}

/* ---------- masthead ---------- */
.eyebrow{
  font-family:"IBM Plex Mono",monospace; font-size:11px; font-weight:500;
  letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3);
}
h1{
  font-size:clamp(30px,5.2vw,52px); font-weight:700; letter-spacing:-.022em;
  line-height:1.04; margin:.28em 0 .18em; text-wrap:balance;
}
.dek{font-size:17px;color:var(--ink-2);max-width:64ch;margin:0 0 26px}
.dek code{font-size:.92em}
code{font-family:"IBM Plex Mono",monospace;background:var(--sunk);padding:.09em .34em;border-radius:3px;font-size:.9em}

/* ---------- env strip ---------- */
.env{
  display:flex;flex-wrap:wrap;gap:0;border:1px solid var(--rule);
  border-radius:8px;background:var(--card);overflow:hidden;margin:0 0 34px
}
.env div{padding:11px 16px;border-right:1px solid var(--rule);flex:1 1 auto;min-width:150px}
.env div:last-child{border-right:0}
.env dt{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--ink-3);margin:0 0 3px}
.env dd{margin:0;font-size:14px;font-weight:500;font-variant-numeric:tabular-nums}

/* ---------- hero stats ---------- */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:0 0 40px}
.stat{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:16px 17px}
.stat .n{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;
  font-size:31px;font-weight:600;letter-spacing:-.03em;line-height:1.05;display:block}
.stat .k{font-size:13px;color:var(--ink-2);margin-top:7px;display:block;line-height:1.4}

h2{font-size:23px;font-weight:600;letter-spacing:-.016em;margin:52px 0 6px;text-wrap:balance}
h2:first-of-type{margin-top:0}
h3{font-size:15px;font-weight:600;margin:30px 0 12px;letter-spacing:-.005em}
p{max-width:68ch}
.sub{color:var(--ink-2);margin:0 0 20px;max-width:68ch}

/* ---------- tabs ---------- */
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}
.tab{
  appearance:none;border:1px solid var(--rule);background:var(--card);color:var(--ink-2);
  border-radius:7px;padding:8px 14px;cursor:pointer;font:inherit;font-size:13.5px;
  display:flex;flex-direction:column;align-items:flex-start;line-height:1.25;text-align:left;
}
.tab b{font-weight:600;color:var(--ink)}
.tab small{font-family:"IBM Plex Mono",monospace;font-size:10.5px;color:var(--ink-3)}
.tab[aria-selected="true"]{border-color:var(--ink);background:var(--sunk)}
.tab:focus-visible{outline:2px solid var(--s1);outline-offset:2px}

/* ---------- legend ---------- */
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin:16px 0 6px;align-items:center}
.lg{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-2)}
.lg i{width:11px;height:11px;border-radius:50%;display:block;flex:none;
  box-shadow:0 0 0 2px var(--card)}

/* ---------- chart ---------- */
.axis{
  position:relative;height:19px;margin-left:var(--lw);border-bottom:1px solid var(--rule-2);
}
.axis span{position:absolute;transform:translateX(-50%);font-family:"IBM Plex Mono",monospace;
  font-size:10.5px;color:var(--ink-3);bottom:2px;white-space:nowrap}
.grp{margin:26px 0 0}
.grp > h4{
  font-family:"IBM Plex Mono",monospace;font-size:10.5px;font-weight:500;letter-spacing:.13em;
  text-transform:uppercase;color:var(--ink-3);margin:22px 0 8px;
  padding-bottom:6px;border-bottom:1px solid var(--rule)
}
.row{display:flex;align-items:center;min-height:40px;border-radius:5px}
.row:hover{background:var(--sunk)}
.rlab{width:var(--lw);flex:none;padding-right:14px;font-size:13px;color:var(--ink-2);
  line-height:1.3;text-align:right}
.strip{position:relative;flex:1;height:40px}
.strip .grid{position:absolute;top:0;bottom:0;width:1px;background:var(--rule);opacity:.75}
.strip .rng{position:absolute;top:50%;height:1.5px;background:var(--rule-2);transform:translateY(-50%)}
.dot{
  position:absolute;top:50%;width:11px;height:11px;border-radius:50%;
  transform:translate(-50%,-50%);box-shadow:0 0 0 2px var(--card);cursor:pointer
}
.row:hover .dot{box-shadow:0 0 0 2px var(--sunk)}
.dot:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.dlab{
  position:absolute;top:50%;transform:translateY(-50%);font-family:"IBM Plex Mono",monospace;
  font-size:10.5px;color:var(--ink-3);white-space:nowrap;padding-left:9px
}
.dlab.flip{transform:translate(-100%,-50%);padding-left:0;padding-right:9px}
.c1{background:var(--s1)} .c2{background:var(--s2)} .c3{background:var(--s3)}
.c4{background:var(--s4)} .c5{background:var(--s5)}

/* ---------- tooltip ---------- */
#tip{
  position:fixed;z-index:50;pointer-events:none;opacity:0;transition:opacity .1s;
  background:var(--card);border:1px solid var(--rule-2);border-radius:7px;
  padding:9px 11px;box-shadow:0 6px 22px rgba(0,0,0,.16);max-width:290px
}
#tip .t{font-size:12.5px;font-weight:600;margin-bottom:5px}
#tip .r{display:flex;justify-content:space-between;gap:16px;font-size:12px;
  font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;color:var(--ink-2)}
#tip .r b{color:var(--ink);font-weight:600}

/* ---------- table ---------- */
.tblwrap{overflow-x:auto;border:1px solid var(--rule);border-radius:8px;background:var(--card);margin:14px 0 0}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:8px 12px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--rule)}
th:first-child,td:first-child{text-align:left;white-space:normal;min-width:230px}
thead th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);
  font-weight:600;position:sticky;top:0;background:var(--card);z-index:1}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--sunk)}
td.v{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
td.best{font-weight:600;color:var(--ink)}
td.up{font-weight:600;color:var(--good)}
td.down{color:var(--warn)}
td.flat{color:var(--ink-3)}
.gh td{background:var(--sunk);font-family:"IBM Plex Mono",monospace;font-size:10.5px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);font-weight:500}

/* ---------- prose blocks ---------- */
.note{border-left:2px solid var(--rule-2);padding:2px 0 2px 16px;margin:16px 0;color:var(--ink-2);max-width:68ch}
.finding{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:18px 20px;margin:14px 0}
.finding h3{margin:0 0 8px}
.finding p{margin:0 0 10px}
.finding p:last-child{margin-bottom:0}
.kv{width:100%;border-collapse:collapse;font-size:12.5px;margin:10px 0 2px}
.kv td{border-bottom:1px solid var(--rule);padding:6px 8px}
.kv td:first-child{text-align:left;color:var(--ink-2);min-width:auto}
.kv tr:last-child td{border-bottom:0}
ul{max-width:68ch;padding-left:20px}
li{margin:5px 0}
footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--rule);
  font-size:12.5px;color:var(--ink-3)}
@media (max-width:720px){
  .rlab{font-size:12px}
  h2{font-size:20px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <span class="eyebrow">Benchmark &middot; Node &amp; Bun &middot; September 2026</span>
  <h1>Four Ways to Add a Day</h1>
  <p class="dek">Native <code>Date</code>, a purpose-built minimal TypeScript library, native
  <code>Temporal</code>, and the two Temporal polyfills &mdash; measured across 21 real
  operations on both runtimes. Every contender was proved to return identical results
  before anything was timed.</p>

  <dl class="env" id="env"></dl>

  <div class="stats" id="stats"></div>

  <h2>Results</h2>
  <p class="sub">Each row is one operation. A dot's position is how many times slower that
  contender is than the fastest contender <em>in that row</em> &mdash; so the left edge is always
  the winner, and the axis is comparable across rows. Log scale.</p>

  <div class="tabs" id="tabs" role="tablist"></div>
  <div class="legend" id="legend"></div>
  <div id="charts"></div>

  <h2>Full numbers</h2>
  <p class="sub">Throughput in operations per second, median of many batched samples.
  Higher is better.</p>
  <div class="tblwrap"><table id="tbl"></table></div>

  <h2>What the numbers actually say</h2>

  <div class="finding">
    <h3>A tight error bar is not the same as a reproducible result</h3>
    <p>Every measurement here reports a relative margin of error, and it is usually 1&ndash;2%.
    That number describes scatter between samples <em>inside one process</em>. It says nothing
    about whether a second run would agree.</p>
    <p>Two scenarios moved by <b>37</b> and <b>53</b> percentage points between consecutive runs
    of identical code, each run reporting an RME under 3%. Across three independent runs the
    between-run spread reaches 35% on the sort scenario and 19% on day-of-week &mdash; caused
    by different JIT decisions and code layout, not by the code under test.</p>
    <p>So a change is only called real on this page when it exceeds 1.5&times; the observed
    between-run spread for that scenario. On the last optimization round that threshold
    rejected two results that looked like wins of +59% and +29%.</p>
  </div>

  <div class="finding">
    <h3>The benchmark was lying about string formatting, and the fix cost chronoFast its best number</h3>
    <p>String results were originally consumed with <code>.length</code> to feed the sink.
    V8's escape analysis can prove a pure-JavaScript concatenation is never observed and
    <em>skip building the string entirely</em> &mdash; but it cannot do that for a builtin
    like <code>Date#toISOString</code>. The hand-rolled formatters were being credited for
    work they never did.</p>
    <table class="kv mono"><tbody>
      <tr><td>toISODate, consumed via .length</td><td style="text-align:right"><b>23.79 ns</b></td></tr>
      <tr><td>toISODate, string forced to exist</td><td style="text-align:right"><b>45.35 ns</b></td></tr>
    </tbody></table>
    <p>Every string result now escapes to a module-level slot, so all contenders pay the
    same materialisation cost &mdash; which is what a real caller does anyway: use it as a
    map key, put it in JSON, write it to a socket. The formatting figures below are the
    corrected ones, and they are less flattering than the first run.</p>
  </div>

  <div class="finding">
    <h3>Branded types cost exactly nothing</h3>
    <p>An instant is a plain <code>number</code>, which is the whole performance premise and
    also indefensible untyped &mdash; nothing stops you passing a duration where an instant
    belongs. Branding fixes that in the type system only, and the erased helper
    (<code>unsafeEpochMs = n =&gt; n</code>) is inlined away completely: <b>5.16 ns</b> through
    the cast versus <b>5.26 ns</b> for raw arithmetic.</p>
    <p>The pair worth having is <code>WallMs</code> distinct from <code>EpochMs</code>. A local
    wall-clock reading is not an instant until a zone resolves it, because it may happen
    twice or not at all. The compiler now refuses to confuse them.</p>
  </div>

  <div class="finding">
    <h3>One idea produced every formatting gain; six others produced none</h3>
    <p>Building a formatted timestamp with a single <code>String.fromCharCode</code> call,
    rather than a chain of concatenations, is the whole of the last optimization round:
    <b>+32%</b> on ISO output, <b>+30%</b> on zoned output, <b>+19%</b> on the parse-add-format
    pipeline.</p>
    <p>What did not work is more instructive. Generalised parse fast paths for the other
    common ISO shapes: 0&ndash;5%, because the longer forms cost more by doing more work, not
    by being scanned badly. Caching the decomposed year/month/day instead of the string:
    measurably <em>slower</em>. Skipping redundant probes in the wall-clock resolver: correct,
    and <b>10% slower</b>, because under scattered access the cached runs are mostly single
    days so the shortcut never fires and its compares are pure cost. That one was reverted
    with the reason recorded in the source.</p>
    <p>Nine of the 21 operations already run at 18&ndash;25&nbsp;ns, where the function call is
    a large share of the cost. There is no 30% hiding in a multiply-add.</p>
  </div>

  <div class="finding">
    <h3>The biggest v2 win was asking <code>Intl</code> a better question</h3>
    <p>v1 derived a zone offset by rebuilding the local wall clock from
    <code>formatToParts</code> &mdash; about fourteen part objects and a civil-date conversion
    &mdash; then subtracting. v2 asks for <code>timeZoneName: 'longOffset'</code> and reads
    <code>GMT+01:00</code> off the end of one formatted string.</p>
    <table class="kv mono"><tbody>
      <tr><td>offset via formatToParts</td><td style="text-align:right"><b>3.52 &micro;s</b></td></tr>
      <tr><td>offset via longOffset</td><td style="text-align:right"><b>1.02 &micro;s</b></td></tr>
    </tbody></table>
    <p>Verified identical across eight zones sampled hourly over two years, including
    Chatham's 45-minute offset. Combined with O(1) run merging, local-midnight resolution
    got <b>9.5&times;</b> faster.</p>
  </div>

  <div class="finding">
    <h3>Native <code>Temporal</code> is shipping, but it is not yet fast</h3>
    <p>V8 has <code>Temporal</code> behind <code>--harmony-temporal</code> in Node 24; Bun 1.3
    does not expose it at all. Where it exists, its ISO parsing is respectable &mdash; but named
    IANA timezone work is not. Reading <code>.hour</code> from an already-built
    <code>ZonedDateTime</code> costs about 80&nbsp;&micro;s, roughly 30&times; a raw
    <code>Intl.DateTimeFormat.formatToParts</code> call, which suggests the DST transition
    bracket is being re-derived on every single access with nothing cached.</p>
  </div>

  <div class="finding">
    <h3><code>temporal-polyfill</code> silently becomes native <code>Temporal</code></h3>
    <p>An early measurement showed the polyfill getting 380&times; slower the moment
    <code>--harmony-temporal</code> was switched on &mdash; for pure JavaScript that should not
    care. It turned out not to be a measurement artifact:</p>
    <table class="kv mono"><tbody>
      <tr><td>TP.Temporal === globalThis.Temporal</td><td style="text-align:right"><b>true</b></td></tr>
      <tr><td>TP.Temporal.Instant === globalThis.Temporal.Instant</td><td style="text-align:right"><b>true</b></td></tr>
    </tbody></table>
    <p><code>temporal-polyfill</code> v1 re-exports the native object when it detects one, so
    under the flag it <em>is</em> native Temporal and inherits its zone performance. Anyone
    benchmarking "polyfill vs native" without checking identity is measuring the same code
    twice. The two are merged into one column here.</p>
  </div>

  <div class="finding">
    <h3>The timezone win comes from caching, not from cleverness</h3>
    <p>chronoFast ships no tzdb. Offsets still come from <code>Intl</code> &mdash; it just calls it
    almost never. Each zone keeps the interval over which its offset is known constant; a miss
    probes the UTC day with two <code>Intl</code> calls; a day containing a DST transition is
    binary-searched to the second once and then cached exactly.</p>
    <table class="kv mono"><tbody>
      <tr><td>50,000 offset lookups over 35 days</td><td style="text-align:right"><b>70 Intl calls</b></td></tr>
      <tr><td>reduction</td><td style="text-align:right"><b>714&times;</b></td></tr>
      <tr><td>hit rate</td><td style="text-align:right"><b>99.86%</b></td></tr>
    </tbody></table>
    <p>That is a technique, not magic &mdash; the same cache could be bolted onto the native
    <code>Date</code> baseline, which here caches only the formatter. Read the timezone rows as
    "caching beats not caching", not "chronoFast beats Intl".</p>
  </div>

  <div class="finding">
    <h3>Temporal's real cost is allocation</h3>
    <p>Adding seven days to an instant allocates roughly <b>23&nbsp;kB</b> under
    <code>temporal-polyfill</code> and about <b>9&nbsp;kB</b> under
    <code>@js-temporal/polyfill</code>, against 16&nbsp;bytes for chronoFast's raw path. In a
    request handler that touches a few dates this is irrelevant. In a loop over ten thousand
    log lines it is the whole story, and it shows up in the p99 as GC pauses.</p>
  </div>

  <div class="finding">
    <h3>Bun is faster at <code>Date</code>; Node is faster at the polyfills</h3>
    <p>JavaScriptCore formats dates far quicker &mdash; <code>toISOString()</code> is
    <b>3.6&times;</b> faster on Bun than on Node, and most native <code>Date</code> operations run
    1.2&ndash;1.9&times; faster. The polyfills lean the other way, generally 0.8&ndash;0.9&times; on
    Bun. chronoFast is close to parity on both, which is what plain integer arithmetic
    should look like.</p>
  </div>

  <h2>How this was measured</h2>
  <ul>
    <li><b>Correctness first.</b> Every contender's output is compared against a reference on
    200 spread indices before it is timed. A disagreement is reported and excluded &mdash;
    a fast wrong answer is not a result. All contenders agreed on all 21 scenarios, in all
    three configurations.</li>
    <li><b>No dead-code elimination.</b> Every measured call feeds an XOR-accumulated sink
    that is read at the end, and reads varying input from a dataset by index. String
    results additionally escape to a module-level slot so the allocation cannot be
    optimised away for some contenders but not others.</li>
    <li><b>Batched to the timer.</b> Iterations are batched until a batch exceeds 1&nbsp;ms,
    putting <code>hrtime</code> overhead below 0.01% of a sample.</li>
    <li><b>Median, not mean</b>, over many samples after a timed JIT warmup; p99 recorded
    separately so allocation-driven tail latency stays visible.</li>
    <li><b>Two distributions.</b> Instants scattered across two years in random order (hostile
    to any cache) for per-operation scenarios; instants clustered in a ~45 day window
    (what log processing actually looks like) for the bulk scenarios.</li>
  </ul>

  <div class="note">
    <p><b>Caveats worth stating.</b> Absolute figures are from one Windows 11 machine, Node
    24.13.0 / V8 13.6 with ICU 77.1 and Bun 1.3.14 &mdash; treat ratios as the finding, not the
    raw ops/sec. The <code>--harmony-temporal</code> run shows lower numbers across
    <em>every</em> contender, including ones that never touch Temporal, so compare within a
    configuration rather than across the two Node columns. chronoFast is millisecond-precision,
    proleptic-Gregorian, ISO-calendar only; Temporal is strictly more capable, and a fair
    reading of these tables is about what you pay for that capability, not whether it is
    worth paying.</p>
  </div>

  <footer>
    Generated from <code>results/*.json</code>. chronoFast's UTC engine is validated against
    native <code>Date</code> over 200,000 random instants, and its timezone engine against the
    Temporal polyfill across 10 zones including Lord Howe, Chatham, and the day Pacific/Apia
    skipped entirely.
  </footer>
</div>

<div id="tip" role="status" aria-live="polite"></div>

<script>
const D = ${JSON.stringify(DATA)};
const LW = 'clamp(150px, 22vw, 260px)';
let active = 0;

const fmtOps = (v) => v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M'
  : v >= 1e3 ? (v/1e3).toFixed(1)+'k' : v >= 1 ? v.toFixed(0) : v.toFixed(2);
const fmtNs = (v) => v >= 1e6 ? (v/1e6).toFixed(2)+' ms' : v >= 1e3 ? (v/1e3).toFixed(2)+' \\u00b5s'
  : v.toFixed(1)+' ns';
const fmtX = (v) => v < 10 ? v.toFixed(1)+'\\u00d7' : Math.round(v).toLocaleString()+'\\u00d7';

// --- axis: fixed decades so every row and every runtime share one scale ---
let MAXX = 1;
for (const r of D.runs) for (const s of r.scenarios) {
  const oks = Object.values(s.e).filter(e => e.o); if (!oks.length) continue;
  const best = Math.max(...oks.map(e => e.o));
  for (const e of oks) MAXX = Math.max(MAXX, best / e.o);
}
const DEC = Math.ceil(Math.log10(MAXX));
const pos = (x) => Math.log10(Math.max(1, x)) / DEC * 100;

// ---------- environment strip ----------
document.getElementById('env').innerHTML = D.runs.map(r =>
  '<div><dt>' + r.runtime.name + ' ' + r.runtime.version + '</dt><dd>' +
  (r.nativeTemporal ? 'native Temporal' : 'no native Temporal') + '</dd></div>'
).join('') + '<div><dt>Engines</dt><dd>V8 13.6 &middot; JSC</dd></div>' +
   '<div><dt>Scenarios</dt><dd>21 &times; 5 contenders</dd></div>';

// ---------- hero stats ----------
function stat(n, k){ return '<div class="stat"><span class="n">'+n+'</span><span class="k">'+k+'</span></div>'; }
const nodeRun = D.runs.find(r => r.tag === 'node');
const sAdd = nodeRun.scenarios.find(s => s.id === 'add-days');
const sZone = nodeRun.scenarios.find(s => s.id === 'zone-offset');
const zoneGain = sZone ? Math.round(sZone.e['chrono-raw'].o / sZone.e['date'].o) : 0;
document.getElementById('stats').innerHTML =
  stat(fmtNs(sAdd.e['chrono-raw'].n), 'chronoFast adds 7 days &mdash; against ' +
       fmtNs(sAdd.e['date'].n) + ' for <code>Date</code> and ' + fmtNs(sAdd.e['temporal-polyfill'].n) + ' for Temporal') +
  stat('0 ns', 'runtime cost of the branded types: 5.16 vs 5.26 ns against raw arithmetic') +
  stat(zoneGain.toLocaleString() + '&times;', 'faster than <code>Date</code> + <code>Intl</code> at resolving a zone offset') +
  stat('0', 'result mismatches &mdash; all contenders agreed on all 21 scenarios, in all 3 configs');

// ---------- tabs ----------
const tabs = document.getElementById('tabs');
tabs.innerHTML = D.runs.map((r,i) =>
  '<button class="tab" role="tab" aria-selected="'+(i===0)+'" data-i="'+i+'">' +
  '<b>'+r.label+'</b><small>'+r.sub+'</small></button>').join('');
tabs.addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  active = +b.dataset.i;
  [...tabs.children].forEach((t,i) => t.setAttribute('aria-selected', String(i===active)));
  render();
});

// ---------- render ----------
function render(){
  const run = D.runs[active];
  const cols = D.ORDER.filter(id => run.contenders.includes(id));

  document.getElementById('legend').innerHTML = cols.map(id =>
    '<span class="lg"><i class="c'+D.SLOT[id]+'"></i>'+D.SHORT[id]+'</span>').join('') +
    (run.tpIsNative ? '<span class="lg" style="color:var(--ink-3)">temporal-polyfill re-exports native Temporal here &mdash; one column</span>' : '');

  // axis
  let ax = '<div class="axis" style="--lw:'+LW+'">';
  for (let d=0; d<=DEC; d++) ax += '<span style="left:'+(d/DEC*100)+'%">'+
    (Math.pow(10,d)).toLocaleString()+'\u00d7</span>';
  ax += '</div>';

  let h = ax, group = null;
  for (const s of run.scenarios){
    if (s.group !== group){ group = s.group; h += '<h4>'+group+'</h4>'; }
    const oks = cols.map(id => [id, s.e[id]]).filter(([,e]) => e && e.o);
    if (!oks.length) continue;
    const best = Math.max(...oks.map(([,e]) => e.o));
    const worst = Math.min(...oks.map(([,e]) => e.o));
    h += '<div class="row"><div class="rlab" style="width:'+LW+'">'+s.name+'</div><div class="strip">';
    for (let d=0; d<=DEC; d++) h += '<div class="grid" style="left:'+(d/DEC*100)+'%"></div>';
    h += '<div class="rng" style="left:0;width:'+pos(best/worst)+'%"></div>';
    // Ties are common (two polyfills often land within a percent of each other) and a
    // coincident dot hides the one beneath it. Stagger overlapping marks vertically —
    // y carries no meaning here, so nothing is distorted.
    const placed = oks.map(([id,e]) => ({ id, e, p: pos(best/e.o) })).sort((a,b) => a.p - b.p);
    let run = [];
    const flush = () => {
      const k = run.length;
      run.forEach((d,i) => { d.dy = k === 1 ? 0 : (i - (k-1)/2) * 9; });
      run = [];
    };
    for (const d of placed){
      if (run.length && d.p - run[run.length-1].p > 1.4) flush();
      run.push(d);
    }
    flush();
    for (const {id,e,p,dy} of placed){
      const x = best/e.o;
      h += '<button class="dot c'+D.SLOT[id]+'" style="left:'+p+'%;margin-top:'+dy+'px" ' +
           'data-t="'+encodeURIComponent(JSON.stringify({n:s.name,l:D.SHORT[id],o:e.o,ns:e.n,b:e.b,x:x}))+'" ' +
           'aria-label="'+D.SHORT[id]+': '+fmtOps(e.o)+' ops per second"></button>';
    }
    const wp = pos(best/worst);
    h += '<span class="dlab'+(wp>80?' flip':'')+'" style="left:'+wp+'%">'+fmtX(best/worst)+'</span>';
    h += '</div></div>';
  }
  document.getElementById('charts').innerHTML = h;

  // table
  let t = '<thead><tr><th>Operation</th>' + cols.map(id => '<th>'+D.SHORT[id]+'</th>').join('') + '</tr></thead><tbody>';
  group = null;
  for (const s of run.scenarios){
    if (s.group !== group){ group = s.group;
      t += '<tr class="gh"><td colspan="'+(cols.length+1)+'">'+group+'</td></tr>'; }
    const oks = cols.map(id => s.e[id]).filter(e => e && e.o);
    const best = oks.length ? Math.max(...oks.map(e => e.o)) : 0;
    t += '<tr><td>'+s.name+'</td>' + cols.map(id => {
      const e = s.e[id];
      if (!e) return '<td class="v" style="color:var(--ink-3)">&mdash;</td>';
      if (!e.o) return '<td class="v" style="color:var(--ink-3)">'+(e.s==='unsupported'?'n/a':e.s)+'</td>';
      return '<td class="v'+(e.o===best?' best':'')+'">'+fmtOps(e.o)+'</td>';
    }).join('') + '</tr>';
  }
  document.getElementById('tbl').innerHTML = t + '</tbody>';
}

// ---------- tooltip ----------
const tip = document.getElementById('tip');
function showTip(el){
  const d = JSON.parse(decodeURIComponent(el.dataset.t));
  tip.innerHTML = '<div class="t">'+d.l+'</div>' +
    '<div class="r"><span>throughput</span><b>'+fmtOps(d.o)+' ops/s</b></div>' +
    '<div class="r"><span>per op</span><b>'+fmtNs(d.ns)+'</b></div>' +
    (d.b !== null && d.b !== undefined ? '<div class="r"><span>allocated</span><b>~'+d.b.toLocaleString()+' B/op</b></div>' : '') +
    '<div class="r"><span>vs fastest</span><b>'+(d.x<1.005?'fastest':fmtX(d.x)+' slower')+'</b></div>';
  const r = el.getBoundingClientRect();
  tip.style.opacity = '1';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - tw - 10, Math.max(8, r.left + r.width/2 - tw/2)) + 'px';
  tip.style.top  = (r.top - th - 9 < 6 ? r.bottom + 9 : r.top - th - 9) + 'px';
}
document.addEventListener('pointerover', e => {
  const d = e.target.closest('.dot'); if (d) showTip(d); else tip.style.opacity = '0';
});
document.addEventListener('focusin', e => { const d = e.target.closest('.dot'); if (d) showTip(d); });
document.addEventListener('focusout', () => { tip.style.opacity = '0'; });
window.addEventListener('scroll', () => { tip.style.opacity = '0'; }, {passive:true});

render();
</script>`;

writeFileSync(new URL('report.html', root), html);
console.log('wrote report.html  (' + (html.length / 1024).toFixed(0) + ' kB)');
