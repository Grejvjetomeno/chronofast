// Nominal types over primitives.
//
// chronoFast's whole premise is that an instant is a plain `number`. That is fast, but
// untyped it is also indefensible: nothing stops you handing a duration to a function
// expecting an instant, or a wall-clock reading to one expecting UTC. Branding recovers
// the safety at exactly zero runtime cost — the brand exists only in the type system and
// is erased entirely by the compiler.

declare const BRAND: unique symbol;

export type Brand<T, B extends string> = T & { readonly [BRAND]: B };

/** Milliseconds since 1970-01-01T00:00:00Z. A real instant. */
export type EpochMs = Brand<number, 'EpochMs'>;

/**
 * A local wall-clock reading expressed as if it were UTC. NOT an instant: until it is
 * resolved against a zone it may be ambiguous (it happens twice) or nonexistent (it is
 * skipped by a DST jump). Keeping it distinct from EpochMs is the single most valuable
 * thing the type system does here.
 */
export type WallMs = Brand<number, 'WallMs'>;

/** A span of milliseconds. */
export type DurationMs = Brand<number, 'DurationMs'>;

/** A UTC offset in milliseconds; always a whole number of seconds. */
export type OffsetMs = Brand<number, 'OffsetMs'>;

/** Whole days since 1970-01-01. */
export type DayIndex = Brand<number, 'DayIndex'>;

/** An IANA timezone identifier that has been checked against Intl. */
export type TimeZoneId = Brand<string, 'TimeZoneId'>;

// ---------------------------------------------------------------- constructors

const MAX_EPOCH_MS = 8.64e15; // the ECMAScript time-value limit

export class InvalidInstantError extends RangeError {
  constructor(value: number) {
    super(`Not a valid instant: ${value}`);
    this.name = 'InvalidInstantError';
  }
}

export class UnknownTimeZoneError extends RangeError {
  constructor(id: string) {
    super(`Unknown IANA time zone: ${id}`);
    this.name = 'UnknownTimeZoneError';
  }
}

/** Checked constructor. Throws on NaN, Infinity, or out-of-range values. */
export function epochMs(n: number): EpochMs {
  if (!Number.isFinite(n) || n < -MAX_EPOCH_MS || n > MAX_EPOCH_MS) {
    throw new InvalidInstantError(n);
  }
  return n as EpochMs;
}

/**
 * Unchecked cast, for hot paths where the value is already known good — the output of
 * parseISO, a database driver's epoch column, another EpochMs. Compiles to nothing.
 */
export const unsafeEpochMs = (n: number): EpochMs => n as EpochMs;

export const unsafeWallMs = (n: number): WallMs => n as WallMs;
export const durationMs = (n: number): DurationMs => n as DurationMs;
export const unsafeOffsetMs = (n: number): OffsetMs => n as OffsetMs;
export const unsafeDayIndex = (n: number): DayIndex => n as DayIndex;

const knownZones = new Set<string>();

/**
 * Checked constructor for a zone id. Validated once per distinct string via Intl and
 * then remembered, so repeat calls are a Set lookup.
 */
export function timeZone(id: string): TimeZoneId {
  if (knownZones.has(id)) return id as TimeZoneId;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
  } catch {
    throw new UnknownTimeZoneError(id);
  }
  knownZones.add(id);
  return id as TimeZoneId;
}

/** Unchecked cast for a zone id known to be valid (a literal, a validated config value). */
export const unsafeTimeZone = (id: string): TimeZoneId => id as TimeZoneId;

/** The sentinel returned by parsing failures. Narrows an EpochMs to a definite value. */
export const isValidInstant = (t: EpochMs): boolean => !Number.isNaN(t);
