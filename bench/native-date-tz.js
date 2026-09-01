// Timezone handling with nothing but native Date + Intl.
//
// This is the code people actually write when they have no date library: a cached
// Intl.DateTimeFormat, formatToParts, and offset = wallClock - utc. It is correct, and
// it is the honest native baseline for the zone scenarios.
//
// It is NOT artificially handicapped - the formatter is cached, which is the single
// biggest win available here. What it does not do is cache the *offset*, because the
// naive version has nowhere obvious to put such a cache. chronoFast's advantage in the
// zone group comes from exactly that caching layer, and the report says so.

const dtfCache = new Map();

function dtfFor(tz) {
  let f = dtfCache.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function tzOffsetMs(tz, ms) {
  const parts = dtfFor(tz).formatToParts(ms);
  let y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], t = p.type;
    if (t === 'year') y = +p.value;
    else if (t === 'month') mo = +p.value;
    else if (t === 'day') d = +p.value;
    else if (t === 'hour') h = +p.value;
    else if (t === 'minute') mi = +p.value;
    else if (t === 'second') s = +p.value;
  }
  if (h === 24) h = 0;
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(ms / 1000) * 1000;
}

// Local wall clock back to an instant, with Temporal 'compatible' disambiguation.
export function utcFromWall(tz, wallMs) {
  const oB = tzOffsetMs(tz, wallMs - 86400000);
  const oA = tzOffsetMs(tz, wallMs + 86400000);
  const u1 = wallMs - oB;
  if (oB === oA) return u1;
  const v1 = tzOffsetMs(tz, u1) === oB;
  const u2 = wallMs - oA;
  const v2 = tzOffsetMs(tz, u2) === oA;
  if (v1 && v2) return u1 < u2 ? u1 : u2;
  if (v1) return u1;
  if (v2) return u2;
  return u1;
}

const p2 = (n) => (n < 10 ? '0' + n : '' + n);
const p3 = (n) => (n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n);
const p4 = (n) => String(n).padStart(4, '0');

export function formatZoned(tz, ms) {
  const off = tzOffsetMs(tz, ms);
  const l = new Date(ms + off);
  const a = off < 0 ? -off : off;
  const mins = Math.floor(a / 60000);
  return p4(l.getUTCFullYear()) + '-' + p2(l.getUTCMonth() + 1) + '-' + p2(l.getUTCDate()) +
         'T' + p2(l.getUTCHours()) + ':' + p2(l.getUTCMinutes()) + ':' + p2(l.getUTCSeconds()) +
         '.' + p3(l.getUTCMilliseconds()) +
         (off < 0 ? '-' : '+') + p2(Math.floor(mins / 60)) + ':' + p2(mins % 60);
}

export function toZonedISODate(tz, ms) {
  const l = new Date(ms + tzOffsetMs(tz, ms));
  return p4(l.getUTCFullYear()) + '-' + p2(l.getUTCMonth() + 1) + '-' + p2(l.getUTCDate());
}

export function startOfDayZoned(tz, ms) {
  const wall = ms + tzOffsetMs(tz, ms);
  const r = ((wall % 86400000) + 86400000) % 86400000;
  return utcFromWall(tz, wall - r);
}

export function addDaysZoned(tz, ms, n) {
  return utcFromWall(tz, ms + tzOffsetMs(tz, ms) + n * 86400000);
}

export function addMonthsZoned(tz, ms, n) {
  const wall = ms + tzOffsetMs(tz, ms);
  const l = new Date(wall);
  const day = l.getUTCDate();
  const target = l.getUTCMonth() + n;
  const y = l.getUTCFullYear() + Math.floor(target / 12);
  const m = ((target % 12) + 12) % 12;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const w = Date.UTC(y, m, day < dim ? day : dim, l.getUTCHours(), l.getUTCMinutes(),
                     l.getUTCSeconds(), l.getUTCMilliseconds());
  return utcFromWall(tz, w);
}
