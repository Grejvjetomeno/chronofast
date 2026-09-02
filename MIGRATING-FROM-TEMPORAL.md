# Migrating from Temporal to chronofast

## Read this first

**This is not a drop-in replacement, and a mechanical find-and-replace will produce code
that compiles, runs, and is silently wrong.**

chronofast models **two** things — an instant, and an instant read through a time zone.
Temporal models **seven**, and the ones a typical codebase leans on hardest are the three
chronofast does not have at all: `PlainDateTime`, `PlainDate`, `PlainTime`.

In a survey of a large production codebase using Temporal (≈4,250 call sites), roughly
**three quarters of all usage was of the plain types**. The single most common call — about
40% of all sites — was `Temporal.Now.plainDateTimeISO()`.

That one has a deliberate, name-for-name equivalent: chronofast's `Now` namespace mirrors
`Temporal.Now`, so those sites are a safe mass rename. The rest of the plain-type surface
does not, and that is what the landmines below are about. Most of them are silent.

---

## The mental model

Temporal separates three ideas that most date libraries conflate:

| Temporal type | is it a moment in time? | carries a zone? |
|---|---|---|
| `Instant` | yes | no |
| `ZonedDateTime` | yes | yes |
| `PlainDateTime` | **no** — a reading off a clock | no |
| `PlainDate`, `PlainTime` | no | no |

chronofast keeps the first two and drops the rest:

| chronofast | equivalent to |
|---|---|
| `ChronoInstant` | `Temporal.Instant`, but with UTC calendar fields readable directly |
| `ChronoZoned` | `Temporal.ZonedDateTime` |

`ChronoInstant` **can** stand in for `PlainDateTime`, because its fields are UTC and read
back exactly as written — store `2024-03-15T10:30`, read `10` from `.hour`. But it is an
instant underneath, so the moment you hand it to anything zone-aware the abstraction leaks.
That trade is the core of this migration.

---

## The five landmines

### 1. `ChronoInstant.now()` is UTC — use `Now.*` instead

`Temporal.Now.plainDateTimeISO()` reads the **local** clock. `ChronoInstant.now()` reads
**UTC**. At 09:07 in Central Europe those are two hours apart, and dates near midnight land
on the **wrong day**, which then propagates into day bucketing and "is it today".

chronofast ships a `Now` namespace whose method names mirror Temporal's, so the migration
is a rename of `Temporal.Now.x()` to `Now.x()`:

| Temporal | chronofast | at 09:07 local |
|---|---|---|
| `Temporal.Now.instant()` | `Now.instant()` | reads 07:07 (UTC) |
| `Temporal.Now.plainDateTimeISO()` | `Now.plainDateTimeISO()` | reads **09:07** |
| `Temporal.Now.plainDateISO()` | `Now.plainDateISO()` | the local date |
| `Temporal.Now.zonedDateTimeISO(z)` | `Now.zonedDateTimeISO(z)` | reads 09:07, zone attached |
| `Temporal.Now.timeZoneId()` | `Now.timeZoneId()` | the system zone |
| `Temporal.Now.plainTimeISO()` | `Now.minutesSinceMidnight()` | a number, not a `PlainTime` |

All take an optional zone and default to the system zone, exactly as Temporal does.
`Now.plainDateTimeISO()` output was verified equal to `Temporal.Now.plainDateTimeISO()`.

**`ChronoInstant.now()` still exists and is still UTC.** It is the right call for storage,
comparison and audit trails. It is the wrong call for anything a user reads.

### 2. The serialised string is different

```ts
Temporal.PlainDateTime.from('2024-03-15T10:30:00').toString()
// '2024-03-15T10:30:00'          no designator, no milliseconds

ChronoInstant.parse('2024-03-15T10:30:00').toISOString()
// '2024-03-15T10:30:00.000Z'     always a Z, always three fractional digits
```

Use **`toPlainISOString()`** for values that are wall-clock readings. It emits exactly what
`Temporal.PlainDateTime#toString()` does, including Temporal's trailing-zero trimming
(`.100` renders as `.1`), verified across all 1,000 millisecond values:

```ts
ChronoInstant.parse('2024-03-15T10:30:00').toPlainISOString()   // '2024-03-15T10:30:00'
```

Reserve `toISOString()` for genuine instants, where the `Z` is true. `toISODate()` is
already identical to `PlainDate.toString()`, so date-only values were always safe.

### 3. Invalid input: Temporal throws, chronofast returns a sentinel

```ts
Temporal.PlainDateTime.from('garbage')     // throws RangeError
ChronoInstant.parse('garbage')             // returns an instance, .isValid === false
```

Any `try`/`catch` around parsing becomes dead code, and any code path that relied on the
throw to stop execution will now carry a `NaN`-backed value forward silently. Grep for
`catch` near date parsing and convert each to an `isValid` check.

The validating factories *do* throw, so use them where you want the old behaviour:

```ts
ChronoInstant.fromEpochMs(n)     // throws InvalidInstantError
ChronoZoned.parse(s, zone)       // throws UnknownTimeZoneError on a bad zone
```

### 4. Millisecond precision, not nanosecond

`epochNanoseconds` does not exist. Anything reading it, or relying on sub-millisecond
ordering, needs rethinking. In practice this bites two places: high-resolution timing
(use `performance.now()` instead) and database columns with microsecond precision, where
values will be **truncated** on round trip.

### 5. Durations are plain numbers, not objects

```ts
a.until(b)              // Temporal: a Duration, e.g. P74D
a.daysUntil(b)          // chronofast: 74
```

There is no `Duration` type, no `.total()`, no ISO-8601 duration strings, no balancing
across units. Code doing duration arithmetic — adding two durations, converting between
units, serialising `P1DT2H` — has no equivalent and must be rewritten.

---

## Translation table

### Constructing

| Temporal | chronofast |
|---|---|
| `Temporal.Now.instant()` | `Now.instant()` |
| `Temporal.Now.plainDateTimeISO()` | `Now.plainDateTimeISO()` |
| `Temporal.Now.plainDateISO()` | `Now.plainDateISO()` |
| `Temporal.Now.zonedDateTimeISO(z)` | `Now.zonedDateTimeISO(z)` |
| `Temporal.Now.timeZoneId()` | `Now.timeZoneId()` |
| `Temporal.Now.plainTimeISO()` | `Now.minutesSinceMidnight()` — a number |
| `Temporal.Instant.from(s)` | `ChronoInstant.parse(s)` |
| `Temporal.Instant.fromEpochMilliseconds(n)` | `ChronoInstant.fromEpochMs(n)` |
| `Temporal.PlainDateTime.from(s)` | `ChronoInstant.parse(s)` |
| `Temporal.PlainDateTime.from({year, month, day, hour})` | `pack(y, m, d, h)` from `chronofast/core`, then wrap |
| `Temporal.PlainDate.from(s)` | `ChronoInstant.parse(s)` — a date-only string is midnight UTC |
| `Temporal.ZonedDateTime.from(s)` | `ChronoZoned.parse(s, zone)` |
| `Temporal.PlainTime.from(s)` | **no equivalent** — model time of day as minutes |

### Reading

| Temporal | chronofast | note |
|---|---|---|
| `.year` `.month` `.day` | same | both 1-based months |
| `.hour` `.minute` `.second` `.millisecond` | same | |
| `.dayOfWeek` | same | both ISO 1–7 |
| `.dayOfYear` `.weekOfYear` | same | |
| `.epochMilliseconds` | same | |
| `.epochNanoseconds` | **gone** | |
| `.daysInMonth` `.inLeapYear` | `daysInMonth(y, m)`, `isLeapYear(y)` from `chronofast/core` | free functions |
| `.offset` | `.offset` is **milliseconds**, not a `'+02:00'` string | |

### Arithmetic

| Temporal | chronofast |
|---|---|
| `.add({ days: 1 })` | `.addDays(1)` |
| `.add({ hours: 2, minutes: 30 })` | `.addHours(2).addMinutes(30)` |
| `.subtract({ days: 1 })` | `.addDays(-1)` |
| `.until(b)` / `.since(b)` | `.daysUntil(b)`, `.monthsUntil(b)` — numbers, not Durations |
| `.with({ hour: 9, minute: 0 })` | **no equivalent** — rebuild via `pack()` |
| `.round({ smallestUnit: 'day' })` | `.startOfDay()` etc. — truncation only, no rounding |
| `Temporal.PlainDateTime.compare(a, b)` | `ChronoInstant.compare(a, b)` |
| `.equals(b)` | `.equals(b)` |

### Zones

| Temporal | chronofast |
|---|---|
| `instant.toZonedDateTimeISO(z)` | `instant.inZone(z)` |
| `zoned.toInstant()` | `zoned.toInstant()` |
| `zoned.toPlainDateTime()` | `zoned.toPlain()` |
| `plainDateTime.toZonedDateTime(z)` | `instant.asLocalIn(z)` |
| `zoned.withTimeZone(z)` | `zoned.withZone(z)` — same instant |
| — | `zoned.withZoneSameLocal(z)` — same wall clock, no Temporal equivalent |
| `zoned.startOfDay()` | `zoned.startOfDay()` |

---

## Patterns

All examples below assume `import { Now, ChronoInstant, ChronoZoned } from 'chronofast';`.

### A value stored without a zone, known to be local

The single most common real-world case, and the one Temporal models with `PlainDateTime`:

```ts
// Temporal
const wall = Temporal.PlainDateTime.from(row.startsAt);
const instant = wall.toZonedDateTime(venueZone).toInstant();

// chronofast
const instant = ChronoZoned.parse(row.startsAt, venueZone).toInstant();
```

`ChronoZoned.parse` reads a designator-less string as a wall-clock reading in that zone,
which is exactly the two-step above collapsed into one call.

### "Is this today, for the user?"

```ts
// Temporal
const today = Temporal.Now.plainDateISO(userZone);
const isToday = Temporal.PlainDate.compare(today, someDate) === 0;

// chronofast — compare local date strings, which are cheap and unambiguous
const isToday = Now.plainDateISO(userZone).toISODate()
             === someInstant.inZone(userZone).toISODate();
```

### Grouping records by day

```ts
// chronofast — the local date string is the key
const key = instant.inZone(zone).toISODate();

// or, for UTC grouping in a hot loop, an integer key with no allocation
import { dayIndexOf } from 'chronofast/core';
const key = dayIndexOf(epochMs);
```

### Adding a calendar day across DST

Both libraries agree here, and both differ from `Date`:

```ts
zoned.addDays(1)      // same wall-clock time tomorrow: 23 or 25 hours across a transition
zoned.addHours(24)    // exactly 24 hours of elapsed time
```

### Business-hours or time-of-day logic

Temporal's `PlainTime` has no equivalent. Model the time of day as minutes since midnight
and compare integers:

```ts
const minutes = zoned.hour * 60 + zoned.minute;
const isOpen = minutes >= 9 * 60 && minutes < 17 * 60;

// for "right now", straight from Now
const isOpenNow = Now.minutesSinceMidnight(venueZone) >= 9 * 60
               && Now.minutesSinceMidnight(venueZone) < 17 * 60;
```

---

## What has no equivalent at all

Before committing to a migration, check whether the codebase depends on any of these:

- **`Temporal.Duration`** — no duration type, no `.total()`, no `P1DT2H` strings, no
  balancing.
- **`PlainTime`** — no time-of-day type. `Now.minutesSinceMidnight(tz)` covers the common
  "what time is it locally" case; anything richer must be modelled by hand.
- **`PlainYearMonth`, `PlainMonthDay`** — no partial-date types.
- **`.with({...})`** — no field-setter; rebuild the value instead.
- **`.round({...})`** — truncation only, via `startOf*`.
- **Non-ISO calendars** — Hebrew, Islamic, Japanese and the rest. ISO only.
- **Nanosecond precision.**
- **`.toLocaleString()` on the date types** — use `Intl.DateTimeFormat` directly against
  `.toDate()` or `.epochMilliseconds`.

Note that `Temporal.Now` itself is **not** on this list: it has a name-for-name equivalent,
and it is the largest single block of call sites in a typical codebase.

---

## A migration strategy

Do not convert everything at once. The two libraries coexist fine — chronofast has no
global state that Temporal touches, and both are plain values.

1. **Inventory first.** Count `Now.plainDateTimeISO`, `PlainTime`, `Duration`, `.with(`
   and `.round(` usage. Those four decide whether this is worth doing at all.
2. **Audit every `toString()` on a date** that crosses a process boundary — database,
   API, cache key, log line you grep. That is landmine 2, and it is the one that
   corrupts data rather than breaking a build.
3. **Start at the edges.** Parsing and formatting at I/O boundaries convert cleanly and
   give most of the performance benefit, because that is where the cost is.
4. **Leave the plain-type-heavy core for last**, or not at all. Mixed use is fine.
5. **`Temporal.Now.` to `Now.` is the one safe mass rename**, because the names and the
   semantics line up deliberately. Do it first: it is the largest block of call sites and
   the one where a hand-rolled substitution is most likely to be wrong.

### When not to migrate

If the codebase leans on `PlainDateTime` everywhere, uses `Duration` arithmetic, or needs
non-ISO calendars, staying on Temporal is the right answer. chronofast is faster and much
smaller, but it is a smaller model of time, and the gap is not something a shim can close
honestly.
