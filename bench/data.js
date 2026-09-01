// Shared, deterministic datasets. Every contender sees byte-identical input.
//
// Two distributions on purpose:
//   SCATTERED  - random instants across two years, in random order. This is the hostile
//                case for any interval cache, chronoFast's included, and it is what the
//                per-operation scenarios use.
//   CLUSTERED  - ten thousand instants inside a ~45 day window, roughly ascending. This
//                is what real log/event processing actually looks like and it is what
//                the bulk scenarios use.
//
// Reporting both is the point: a cache that only wins on clustered data should be seen
// to only win on clustered data.

export const TZ = 'Europe/Bratislava';

// deterministic LCG - same data on every run, on every runtime
let seed = 0x2f6e2b1;
function rnd() {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

export const N = 1024;
export const MASK = N - 1;

const SPAN_START = Date.UTC(2024, 0, 1);
const SPAN_END = Date.UTC(2025, 11, 31);
const SPAN = SPAN_END - SPAN_START;

// ---------------------------------------------------------------- scattered
export const MS = new Array(N);
export const MS_B = new Array(N);
for (let i = 0; i < N; i++) {
  MS[i] = SPAN_START + Math.floor(rnd() * SPAN);
  MS_B[i] = SPAN_START + Math.floor(rnd() * SPAN);
}

export const ISO_UTC = MS.map((ms) => new Date(ms).toISOString());

// Same instants, written with a non-zero UTC offset, as a real API payload from a
// European client would carry.
export const ISO_OFF = MS.map((ms) => {
  const offMin = [120, -300, 330, 60, -480, 0][ms % 6];
  const local = new Date(ms + offMin * 60000);
  const p = (n, w) => String(n).padStart(w, '0');
  const sign = offMin < 0 ? '-' : '+';
  const a = Math.abs(offMin);
  return p(local.getUTCFullYear(), 4) + '-' + p(local.getUTCMonth() + 1, 2) + '-' + p(local.getUTCDate(), 2) +
         'T' + p(local.getUTCHours(), 2) + ':' + p(local.getUTCMinutes(), 2) + ':' + p(local.getUTCSeconds(), 2) +
         '.' + p(local.getUTCMilliseconds(), 3) + sign + p(Math.floor(a / 60), 2) + ':' + p(a % 60, 2);
});

// A set deliberately seeded with instants next to DST transitions, so the zone
// scenarios exercise the transition paths rather than only steady state.
const DST_ANCHORS = [
  Date.UTC(2024, 2, 31, 1, 0), Date.UTC(2024, 9, 27, 1, 0),
  Date.UTC(2025, 2, 30, 1, 0), Date.UTC(2025, 9, 26, 1, 0),
];
export const MS_DST = new Array(N);
for (let i = 0; i < N; i++) {
  MS_DST[i] = i % 4 === 0
    ? DST_ANCHORS[i % DST_ANCHORS.length] + Math.floor((rnd() - 0.5) * 6 * 3600000)
    : SPAN_START + Math.floor(rnd() * SPAN);
}

// ---------------------------------------------------------------- clustered (bulk)
export const BULK = 10000;
const BULK_START = Date.UTC(2025, 4, 1);
export const BULK_MS = new Array(BULK);
{
  let t = BULK_START;
  for (let i = 0; i < BULK; i++) {
    t += Math.floor(rnd() * 800000);              // ~0-13 min apart => ~45 days total
    BULK_MS[i] = t;
  }
}
export const BULK_ISO = BULK_MS.map((ms) => new Date(ms).toISOString());

// ---------------------------------------------------------------- sort input
export const SORT_N = 2000;
export const SORT_MS = new Array(SORT_N);
for (let i = 0; i < SORT_N; i++) SORT_MS[i] = SPAN_START + Math.floor(rnd() * SPAN);
