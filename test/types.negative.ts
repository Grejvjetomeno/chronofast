// Type-level regression test.
//
// Every `@ts-expect-error` below asserts that the line does NOT compile. If a future change
// makes one of them legal again, tsc fails with "Unused '@ts-expect-error' directive" - so
// this file catches the re-introduction of the exact confusions that motivated splitting
// ChronoInstant into three types.
//
// Run with: npx tsc --noEmit -p tsconfig.types-test.json

import { ChronoInstant, ChronoPlain, ChronoZoned, Now } from '../src/index.js';

const inst: ChronoInstant = Now.instant();
const plain: ChronoPlain = Now.plainDateTimeISO();
const zoned: ChronoZoned = Now.zonedDateTimeISO();

// ---------------------------------------------------------------- a moment has no fields
// @ts-expect-error a moment is not a year and a month until a clock reads it
inst.year;
// @ts-expect-error
inst.month;
// @ts-expect-error
inst.hour;
// @ts-expect-error
inst.dayOfWeek;
// @ts-expect-error calendar arithmetic needs a calendar, which needs a zone
inst.addMonths(1);
// @ts-expect-error
inst.startOfDay();

// ---------------------------------------------------------------- a reading has no moment
// @ts-expect-error a reading has no instant until a zone says which one it is
plain.epochMilliseconds;
// @ts-expect-error
plain.toDate();
// @ts-expect-error a reading cannot be converted as though it were a moment
plain.inZone('UTC');
// @ts-expect-error
plain.toISOString();

// ---------------------------------------------------------------- the two cannot be mixed
// @ts-expect-error this used to compile and silently misorder a sorted array
ChronoInstant.compare(plain, inst);
// @ts-expect-error
ChronoPlain.compare(inst, plain);
// @ts-expect-error
inst.isAfter(plain);
// @ts-expect-error
plain.isBefore(inst);
// @ts-expect-error
inst.equals(plain);
// @ts-expect-error a mixed array has no common comparator
[inst, plain].sort(ChronoInstant.compare);

// ---------------------------------------------------------------- operator comparison
// Same-type `<` is allowed and correct; mixing types is not, and subtraction is not.
// @ts-expect-error a reading and a moment are not on the same scale
plain < inst;
// @ts-expect-error
inst > plain;
// @ts-expect-error a moment and a zoned moment are both moments, but TS still refuses
inst < zoned;
// @ts-expect-error `-` on objects is rejected; use millisecondsUntil()
inst - inst;
// @ts-expect-error
plain - plain;

// ---------------------------------------------------------------- branded primitives too
// @ts-expect-error WallMs is not EpochMs
const bad1: ChronoInstant = new ChronoInstant(plain.wall);
// @ts-expect-error EpochMs is not WallMs
const bad2: ChronoPlain = new ChronoPlain(inst.ms);
// @ts-expect-error a raw number is neither
const bad3: ChronoInstant = new ChronoInstant(1700000000000);

// ---------------------------------------------------------------- what MUST still compile
const ok1: number = inst.epochMilliseconds;
const ok2: number = plain.hour;
const ok3: number = zoned.hour;
const ok4: number = zoned.epochMilliseconds;
const ok5: ChronoZoned = plain.assumeZone('Europe/Bratislava');
const ok6: ChronoPlain = zoned.toPlain();
const ok7: ChronoInstant = zoned.toInstant();
const ok8: ChronoPlain = inst.toUtcPlain();
const ok9: ChronoZoned = inst.inZone('UTC');
const ok10: string = plain.toPlainISOString();
const ok11: string = inst.toISOString();
const ok12: -1 | 0 | 1 = ChronoPlain.compare(plain, plain);
const ok13: -1 | 0 | 1 = ChronoInstant.compare(inst, inst);
const ok14: boolean = inst < inst;          // same type: allowed, ordered by valueOf
const ok15: boolean = plain <= plain;
const ok16: boolean = zoned >= zoned;
const ok17: number = inst.millisecondsUntil(inst);
const ok18: number = plain.hoursUntil(plain);
const ok19: number = zoned.daysUntil(zoned);

export const used = [bad1, bad2, bad3, ok1, ok2, ok3, ok4, ok5, ok6, ok7, ok8, ok9, ok10,
                     ok11, ok12, ok13, ok14, ok15, ok16, ok17, ok18, ok19];
