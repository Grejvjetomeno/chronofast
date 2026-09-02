# Changelog

All notable changes to chronofast. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Note on versioning.** 1.0.1 contains two changes that are semver-major by the letter:
> `parse` now throws where it used to return an invalid instance, and `ChronoPlain.parse`
> returns a different value for strings carrying a UTC offset. They ship as a patch because
> 1.0.0 was published the same day and had no dependents — a deliberate, one-time call
> rather than a precedent. From here on, semver applies normally.

---

## [1.0.1]

Three defects fixed, two of which produced silently wrong values rather than errors. One
new type, and locale formatting that previously did not exist.

### Fixed

- **Invalid values serialised to strings containing NUL bytes.** `toISO` builds its result
  with a single `String.fromCharCode(...)` call whose digit arguments are computed
  arithmetically. On a `NaN` instant every argument was `NaN`, and `String.fromCharCode(NaN)`
  is `U+0000`, so an invalid moment serialised to `"000<NUL>-03-0<NUL>T00:00:00.00<NUL>Z"` (each `<NUL>` a real `U+0000`).
  That is close enough to a timestamp to travel — into JSON, then into storage, where
  Postgres rejects NUL in `text` and `jsonb` far from the parse that caused it. The
  serialisers now follow `Date` exactly:

  | | before | after |
  |---|---|---|
  | `toISOString()` | NUL-bearing string | throws `RangeError: Invalid time value` |
  | `toISODate()` | `"+NaN-03-NaN"` | throws `RangeError` |
  | `toPlainISOString()` | `"NaN-03-NaNT00:00:00.NaN"` | throws `RangeError` |
  | `toString()` | NUL-bearing string | `'Invalid Date'` |
  | `toJSON()` | NUL-bearing string | `null` |
  | `JSON.stringify({t})` | `{"t":"000\u0000-…"}` | `{"t":null}` |

  Guarded in `core` (`toISO`, `toISODate`), so the raw function layer is covered too, not
  just the classes. `zone` already threw; this makes the UTC path consistent with it.

- **`ChronoPlain.parse` shifted the reading by any UTC offset in the string.** A wall clock
  with no zone must keep the time as written; applying the offset changed both the time and
  the date:

  ```
  ChronoPlain.parse('2024-03-15T23:30:00-05:00')
    before:  2024-03-16T04:30:00      ← wrong time and wrong date
    after:   2024-03-15T23:30:00      ← matches Temporal.PlainDateTime.from
  ```

  `ChronoInstant` and `ChronoZoned` are deliberately unaffected — an offset *should* shift a
  moment, and both still agree with Temporal.

- **`ChronoInstant.fromDate` laundered an invalid `Date` into a NaN-carrying instant.** It
  now throws `InvalidInstantError`.

### Changed — breaking

- **`parse` fails closed.** `ChronoInstant.parse`, `ChronoPlain.parse` and
  `ChronoZoned.parse` throw `InvalidInstantError` on malformed input instead of returning an
  instance whose `isValid` is `false`.

  The old behaviour was a trap, because `NaN` makes *both* sides of a comparison false:

  ```ts
  const t = ChronoInstant.parse(garbage);   // old behaviour
  t.epochMilliseconds >= Date.now()         // false
  t.epochMilliseconds <  Date.now()         // false, too
  ```

  A timestamp nobody could read did not compare *wrong* — it silently took the else-branch
  of every comparison downstream. Code asking "is this still in the future?" answered "no"
  for a value it never understood. `Temporal.Instant.from` throws on the same inputs, so
  code already catching `RangeError` needs no change; `InvalidInstantError` extends
  `RangeError`.

  The library was already inconsistent here: `fromEpochMs(NaN)` threw while
  `parse('garbage')` did not. Both fail closed now.

- **`toJSON()` is typed `string | null`** rather than `string`, on every type.

### Added

- **`tryParse`** on all four types — the same parser with a `null` return instead of a
  throw, for untrusted input where a bad value is expected and handled:

  ```ts
  const t = ChronoInstant.tryParse(row.timestamp);
  if (t === null) { logRejected(row); continue; }
  ```

- **`ChronoDate`** — a calendar date with no time of day and no zone, equivalent to
  `Temporal.PlainDate`. It has no `hour` and no `addHours`: a birthday, an invoice date or a
  hotel night is not a moment, and the type refuses the question rather than answering it
  wrongly. Reaching a time is explicit — `toPlain()`, `atTime(h, m)`, `atStartOfDay(tz)`.

  Stored as a **day index** (days since 1970-01-01), not a timestamp. A midnight timestamp
  in 2024 is ~1.7e12 and is boxed by V8; a day index is ~19,800 and stays an immediate.
  Measured against the wall-millisecond representation the same type would need in order to
  inherit from `ChronoPlain`:

  | operation | day index | wall ms |
  |---|---:|---:|
  | `daysUntil` | 1.25 ns | 3.74 ns |
  | `fields()` | 11.8 ns | 24.5 ns |
  | `addMonths` | 21.0 ns | 28.0 ns |
  | `toISODate` | 35.4 ns | 40.7 ns |
  | sort 1024 | 66.0 µs | 70.8 µs |

  Against `Temporal.PlainDate` on Node 24: `daysUntil` 14,890×, `addDays` 1,118×,
  `addMonths` 65×, `parse` 66×, `toISODate` 4×, sorting 12×.

  Parse rules match `Temporal.PlainDate.from` exactly, including rejecting a trailing `Z`
  (which calendar day a moment falls on depends on a zone the string does not name) while
  accepting an explicit offset (which still describes a local wall clock).

- **`toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`** on all four types.

  Previously none of the classes defined these, so the call resolved to
  `Object.prototype.toLocaleString`, which delegates to `toString()` and ignores both the
  locale and the options. Nothing threw, and `typeof x.toLocaleString` was still
  `'function'`, so the absence was invisible to feature detection — every localised date in
  a UI rendered as an ISO string.

  | type | renders in | default output | matches |
  |---|---|---|---|
  | `ChronoPlain` | `UTC` over wall ms | date + time | `Temporal.PlainDateTime` |
  | `ChronoDate` | `UTC` over wall ms | date only | `Temporal.PlainDate` |
  | `ChronoZoned` | its own zone | date + time + zone name | `Temporal.ZonedDateTime` |
  | `ChronoInstant` | host zone | date + time | `Temporal.Instant` |

  Verified against Temporal across 7 locales and every option shape. A `timeZone` option on
  a zoneless type is ignored, as Temporal ignores it. Invalid values return `'Invalid Date'`
  rather than throwing inside a render.

  `Intl.DateTimeFormat` instances are cached on (locale, options, zone): **~890 ns per call
  against ~35 µs** for constructing a formatter each time. The cache is bounded at 256
  entries so option objects built in a loop cannot grow it without limit.

- **`toPlainDate()`** on `ChronoPlain` and `ChronoZoned`. On `ChronoZoned` it yields the
  **local** calendar date — which day an instant falls on is a question only a zone can
  answer.

- New raw-layer functions in `chronofast/core`, all day-index native so they skip the
  `Math.floor(ms / MS_DAY)` divide: `isoDateOfDay`, `dayOfWeekOfDay`, `dayOfYearOfDay`,
  `isoWeekOfDay`, `isoWeekYearOfDay`, `startOfMonthOfDay`, `startOfYearOfDay`,
  `startOfWeekOfDay`, `endOfMonthOfDay`, `addMonthsOfDay`, `diffMonthsOfDay`. Plus
  `parseISOWall` (wall clock as written, offset discarded), `hasUtcDesignator`, and
  `parsedOffsetMs`. In `chronofast/zone`: `formatLocale` and `localeFormatterCount`.

### Performance

- **`addMonths` ~10% faster.** `Math.floor(total / 12)` replaced by `total % 12` with a sign
  fix — the year then divides exactly — and the month-length array replaced by a 12-bit mask,
  which skips a bounds check. Verified identical to the previous implementation on 500,000
  cases spanning the full time range with `n` from −200 to +199. `addYears` routes through
  `addMonths`, so it gains the same.

  | | before | after |
  |---|---:|---:|
  | `add-months` (Node) | 34 ns | 31 ns |
  | `add-months` (Bun) | 34 ns | 30 ns |
  | `add-months-obj` (Node) | 31 ns | 29 ns |

### Documentation

- README gained sections on the fail-closed parse contract and on millisecond precision:
  sub-millisecond digits are **truncated silently**, byte-identically to `Date.parse`.
  Microsecond input is accepted rather than rejected, because Postgres `timestamptz` emits
  it by default — but a value read from such a column, parsed and written back has lost
  precision. This is the one place where migrating from Temporal loses information rather
  than only changing syntax.

- Corrected the `valueOf` documentation, which claimed TypeScript prevented comparing a
  `ChronoPlain` with a `ChronoInstant`. It does prevent the direct comparison —
  `Operator '<' cannot be applied to types 'ChronoPlain' and 'ChronoInstant'` — but not
  once either side is unwrapped: `p.valueOf() < i.valueOf()` compares a wall clock against
  an epoch instant and answers with whichever number is larger. Plain JavaScript has no
  guardrail at all here.

- Fixed the README's opening example, which had not survived the three-type split —
  `t.year` and `t.addMonths` are `undefined` on `ChronoInstant`.

### Testing

- 529 unit tests (from 388), 68 suites. New files: `test/invalid.test.js`,
  `test/date.test.js`, `test/locale.test.js`.
- 72 prepublish assertions (from 52). The new ones pin the safety properties directly: that
  `parse` throws `RangeError` on malformed input, that `ChronoDate` carries no time-of-day
  capability, that `ChronoPlain` keeps the wall clock as written, and that every type
  *defines* `toLocale*` rather than inheriting `Object.prototype`'s.

### Size

Minified ESM bundle 6.95 kB gzip (from 5.75 kB); IIFE 7.15 kB gzip. The increase is the
locale-formatting layer and `ChronoDate`.

---

## [1.0.0]

Initial release.

### Added

- `ChronoInstant`, `ChronoPlain`, `ChronoZoned` — a moment, a wall-clock reading, and the
  two together. Capabilities are *removed* rather than documented away: a `ChronoInstant`
  has no calendar fields, a `ChronoPlain` has no `epochMilliseconds`.
- `Now` namespace mirroring `Temporal.Now`, so the choice of clock is explicit at the call
  site rather than implied.
- IANA time zones without bundling a tzdb: offsets derived from `Intl`, then cached over the
  intervals on which each offset is constant. 50,000 lookups across 35 days cost 70 `Intl`
  calls.
- Raw function layer exported from `chronofast/core` and `chronofast/zone`.
- Branded nominal types (`EpochMs`, `WallMs`, `TimeZoneId`, `DayIndex`) — zero runtime cost.
- `InvalidInstantError`, `UnknownTimeZoneError`, `AmbiguousTimeError`, all extending
  `RangeError`.
- Minified ESM and IIFE browser bundles, ES2020.
- Fallback for engines without `Intl.DateTimeFormat`'s `longOffset` (Chrome <95, Firefox
  <91, Safari <15.4), which throws at *construction* rather than on use.
- Benchmark harness with a correctness gate — nothing is timed until it agrees with a
  reference — and one process per measurement, because measurement order was found to skew
  results by up to 5.7×.
