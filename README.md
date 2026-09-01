# chronofast

Performance-oriented, fully typed date library for JavaScript and TypeScript.
Real IANA time zones **without bundling a tzdb**. Zero dependencies.

```bash
npm install chronofast
```

```ts
import { ChronoInstant } from 'chronofast';

const t = ChronoInstant.parse('2024-03-15T10:30:00.000Z');

t.year                                   // 2024  (UTC)
t.addDays(7).toISOString()               // '2024-03-22T10:30:00.000Z'
t.addMonths(1).toISODate()               // '2024-04-15'

const z = t.inZone('Europe/Bratislava');
z.hour                                   // 11  (local)
z.toISOString()                          // '2024-03-15T11:30:00.000+01:00'
z.addDays(1).toISOString()               // a calendar day, not 24 hours
```

## Why another date library

Most libraries pick one of three deals on time zones: skip them (fast, but you write the
DST bugs yourself), bundle the IANA database (correct, but hundreds of kilobytes), or call
`Intl` on every lookup (correct, small, and slow — microseconds per operation).

chronofast takes a fourth: derive offsets from `Intl`, then **cache the intervals over
which each offset is constant**, so `Intl` is consulted about twice per distinct UTC day
rather than once per timestamp.

> 50,000 offset lookups across 35 days cost **70** `Intl` calls — a 714× reduction,
> 99.86% hit rate. Reproduce it with `npm test`.

That is the whole trick. It is a technique, not magic, and the benchmark says so out loud.

## Performance

Node 24 (V8 13.6), operations per second, higher is better. **Every measurement runs in its
own process** — see [below](#on-trusting-benchmark-numbers) for why that turned out to be
non-negotiable. Full tables in [`REPORT.md`](./REPORT.md); reproduce with `npm run bench`.

| Operation | `Date` | **chronofast** | temporal-polyfill | vs `Date` |
|---|--:|--:|--:|--:|
| Parse ISO-8601 UTC | 7.00M | **27.07M** | 354.9k | 4× |
| Parse ISO-8601 with offset | 6.81M | **15.67M** | 294.1k | 2× |
| Format to ISO-8601 | 1.24M | **15.77M** | 323.4k | 13× |
| Format `YYYY-MM-DD` | 1.91M | **22.92M** | 184.5k | 12× |
| Add 7 days | 10.87M | **367.11M** | 113.8k | 34× |
| Add 1 month, clamped | 3.96M | **30.76M** | 119.4k | 8× |
| Calendar days between two instants | 4.41M | **269.04M** | 29.3k | 61× |
| Read all six calendar fields | 8.13M | **39.92M** | 190.2k | 5× |
| Parse → +30 days → format | 1.34M | **9.04M** | 69.0k | 7× |

### Time zones

| Operation | `Date` + `Intl` | **chronofast** | temporal-polyfill | vs `Date` |
|---|--:|--:|--:|--:|
| UTC offset for an instant | 369.9k | **45.75M** | 151.1k | 124× |
| Format as local ISO with offset | 317.1k | **10.79M** | 119.8k | 34× |
| Add 1 local day across DST | 114.1k | **15.83M** | 89.5k | 139× |
| Local midnight | 105.6k | **16.35M** | 88.5k | 155× |
| Bucket 10,000 instants by local day | 34.3 | **8.9k** | 10.9 | 261× |

**Read these rows carefully.** chronofast's advantage here is the offset cache. The `Date`
baseline caches the `Intl.DateTimeFormat` — the single biggest win available to it — but not
the offset, because the naive approach has nowhere obvious to put such a cache. These rows
say *caching beats not caching*, which is a fair thing to measure but is not the same claim
as *chronofast is 124× faster than Intl*.

### Allocation

Adding seven days to an instant, approximate bytes allocated per operation:

| | bytes/op |
|---|--:|
| chronofast (raw) | **17** |
| chronofast (class) | 97 |
| `Date` | 145 |
| `@js-temporal/polyfill` | 8,453 |
| `temporal-polyfill` | 23,170 |

In a request handler touching a few dates this is irrelevant. In a loop over ten thousand
log lines it is the whole story, and it shows up in the p99 as GC pauses.

Nothing is timed until it has been proved correct: every contender is compared against a
reference on 200 spread indices first, and any that disagrees is reported and excluded. A
fast wrong answer is not a result.

## API

Two immutable classes. Every method returns a new instance; nothing mutates.

### `ChronoInstant` — a point on the UTC timeline

```ts
ChronoInstant.parse('2024-03-15T10:30:00.000Z')
ChronoInstant.fromEpochMs(1710498600000)   // throws InvalidInstantError if not finite
ChronoInstant.fromDate(new Date())
ChronoInstant.now()
```

| | |
|---|---|
| **Fields** (UTC) | `year` `month` `day` `hour` `minute` `second` `millisecond` |
| | `dayOfWeek` (1 = Mon … 7 = Sun) `dayOfYear` `weekOfYear` `weekYear` |
| | `fields()` — all seven from a single conversion |
| **Arithmetic** | `addMilliseconds` `addSeconds` `addMinutes` `addHours` `addDays` `addWeeks` `addMonths` `addYears` |
| **Truncation** | `startOfMinute` `startOfHour` `startOfDay` `startOfWeek` `startOfMonth` `startOfYear` |
| **Compare** | `equals` `isBefore` `isAfter` `daysUntil` `monthsUntil` `ChronoInstant.compare` |
| **Output** | `toISOString()` `toISODate()` `toDate()` `toJSON()` `epochMilliseconds` |
| **Convert** | `inZone(tz)` → `ChronoZoned` |

Month arithmetic clamps to the end of the month and is leap-aware:

```ts
ChronoInstant.parse('2024-01-31T00:00:00.000Z').addMonths(1).toISODate()  // '2024-02-29'
ChronoInstant.parse('2023-01-31T00:00:00.000Z').addMonths(1).toISODate()  // '2023-02-28'
```

### `ChronoZoned` — the same instant, read through an IANA zone

```ts
ChronoZoned.parse('2024-03-15T10:30:00Z', 'Europe/Bratislava')
ChronoZoned.fromEpochMs(1710498600000, 'America/New_York')
ChronoZoned.fromLocal('Europe/Bratislava', 2024, 3, 15, 11, 30)
```

Same field and output surface as `ChronoInstant`, read in local time, plus `offset`,
`offsetHours`, `withZone(tz)` and `toInstant()`.

The distinction that matters is between **exact-time** and **calendar** units:

```ts
const z = ChronoZoned.fromEpochMs(Date.parse('2024-03-30T12:00:00Z'), 'Europe/Bratislava');

z.addHours(24)   // exactly 24 hours later
z.addDays(1)     // the same wall-clock time tomorrow — 23 hours, because DST starts
```

`addDays`, `addMonths`, `addYears` and `startOfDay` all resolve through local wall time, so
they do what a calendar says rather than what a stopwatch says.

### Ambiguous and nonexistent local times

A local time can happen twice (autumn) or never (spring). `fromLocal` resolves this with
Temporal's `'compatible'` rule by default — earlier of an ambiguous pair, shifted forward
across a gap — and accepts `'earlier'`, `'later'` or `'reject'`:

```ts
// 02:30 on 2024-03-31 does not exist in Bratislava; the clock jumps 02:00 -> 03:00
ChronoZoned.fromLocal('Europe/Bratislava', 2024, 3, 31, 2, 30).toISOString()
// '2024-03-31T03:30:00.000+02:00'

ChronoZoned.fromLocal('Europe/Bratislava', 2024, 10, 27, 2, 30, 0, 0, 'reject')
// throws AmbiguousTimeError
```

### Errors

| | thrown when |
|---|---|
| `InvalidInstantError` | `fromEpochMs` gets NaN, Infinity, or a value outside the ECMAScript time range |
| `UnknownTimeZoneError` | a zone id `Intl` does not recognise |
| `AmbiguousTimeError` | `'reject'` disambiguation hits an ambiguous or nonexistent local time |

## Types

An instant is a plain `number` — that is the performance premise. Branding makes it safe at
zero runtime cost, because the brand exists only in the type system and the compiler erases
it entirely:

```ts
type EpochMs = number & { readonly [BRAND]: 'EpochMs' };
type WallMs  = number & { readonly [BRAND]: 'WallMs'  };
```

Keeping `WallMs` distinct from `EpochMs` is the most useful thing the types do: a
wall-clock reading is not an instant until a zone resolves it, because it may be ambiguous
or may not exist. The compiler refuses to confuse them.

Cost of the branding, measured against raw arithmetic — median of five runs each, every
run in its own process: **0.668 ns vs 0.664 ns**. The 0.004 ns gap sits well inside the
0.02–0.11 ns spread between runs, so the honest reading is *no measurable cost*. V8 inlines
the erased helper away entirely.

Exported types: `EpochMs`, `TimeZoneId`, `DateTimeFields`, `Disambiguation`.

## The raw layer

The classes are a thin wrapper over functions operating on plain epoch-ms numbers, which
allocate nothing at all. That layer is not part of the public API, but it is importable if
you are in a hot loop and want it:

```ts
import { parseISO, addDays, toISO } from 'chronofast/core';
import { offsetAt, formatZoned } from 'chronofast/zone';

toISO(addDays(parseISO('2024-03-15T10:30:00.000Z'), 7));
```

Treat it as a sharp tool: it uses module-scoped scratch slots for multi-value returns, so
read the results before the next call.

## Limitations, stated plainly

- **Millisecond precision.** Not nanoseconds. `Temporal` is strictly more capable here.
- **Proleptic Gregorian, ISO calendar only.** No Hebrew, Islamic, Japanese calendars.
- **No `Duration` type**, no relative formatting, no parsing of human text.
- **The zone engine assumes at most one offset transition per UTC day**, not reversing
  within that day. True for every zone in the current IANA database.
  `offsetAtUncached()` in `chronofast/zone` is the assumption-free path, and the test suite
  uses it to validate the cache hourly across two years.
- **Cache state is process-global.** Correct under any access pattern — the test suite
  interleaves unrelated day-clusters specifically to prove it — but it does mean memory
  grows with the number of distinct days you touch.

### Where chronofast is deliberately stricter than `Date`

| Input | `Date.parse` | chronofast |
|---|---|---|
| `2023-02-29T00:00:00.000Z` | silently rolls to **2023-03-01** | `NaN` |
| `2024-03-15T24:00:00.000Z` | accepts hour 24 | `NaN` |
| `2024-03` | accepts year-month | `NaN` |

The first is a footgun worth rejecting, and `Temporal` rejects it too. The other two are
valid grammar that chronofast does not implement. All three are asserted as contract in the
test suite rather than treated as bugs.

## Size

```
file                 raw        gzip      brotli
------------------------------------------------
brand.js         2.21 kB     0.99 kB     0.83 kB
core.js         20.08 kB     5.78 kB     5.00 kB
index.js         6.98 kB     1.89 kB     1.64 kB
zone.js         13.04 kB     4.51 kB     3.90 kB
------------------------------------------------
TOTAL           42.31 kB    13.17 kB    11.36 kB
```

Unminified, and comments are a good share of it — the source explains why things are the
way they are, including what was tried and rejected. A bundler that minifies will land well
below the gzip figure. Reproduce with `npm run size`.

## Testing and benchmarking

```bash
npm test          # build, then the full correctness gate
npm run bench     # Node
npm run bench:all # Node, Node --harmony-temporal, Bun, then build the report
npm run size      # what actually ships
```

The correctness gate is not a unit-test suite; it is a differential one. It checks the UTC
engine against native `Date` over 200,000 random instants, the parser across every accepted
ISO form plus 1,488 date-validity cases, and the zone engine against both `Intl` and the
Temporal polyfill across ten zones — including Lord Howe (30-minute DST), Chatham (+12:45)
and the day Pacific/Apia skipped entirely.

### On trusting benchmark numbers

Two things in this harness exist because the obvious version of it was measurably wrong.

**Every measurement runs in its own process.** `measure()` calls the function under test
through a shared call site. As distinct closures pass through it, that site goes megamorphic
— so identical code measured *second* in a process reads far slower than the same code
measured first. Eight byte-identical functions, run through one shared loop:

| position | ns/op |
|---|--:|
| 1st measured | 0.694 |
| 2nd–8th measured | ~3.97 |
| each alone in a fresh process | 0.685–0.689 |

A 5.7× penalty for measurement order. Giving each measurement its own closure does not help
— V8 keys the feedback to the function literal. A fresh process per `(scenario, contender)`
is the only thing that reproduces ground truth, so that is what the harness does. Reproduce
with `node bench/probe-ic-pollution.js`.

**Batches are checked against clock granularity.** Process isolation then exposed a second
bug: with a cold cache the first zone call constructs an `Intl.DateTimeFormat` and probes
days, which alone exceeded the target batch time — so the calibrator left the batch size at
one iteration and every sample became a single ~200 ns operation read through a 100 ns
clock. Four unrelated operations all reported exactly 5.00M ops/s. There is now a priming
phase before calibration, and any batch shorter than 50 timer ticks is flagged
`LOW RESOLUTION` in the output and in the JSON.

**The reported margin of error still understates the truth.** It measures scatter between
samples, not variation between runs. Two scenarios here have swung 37 and 53 percentage
points between consecutive runs of identical code while each reported an RME under 3%. Run
the benchmark several times with different `--tag`s before believing any single delta —
including the ones in this README.

## License

MIT © [Bruno Laurinec](https://github.com/brunolau)
