// Day.js with the plugins needed to reach parity with the other contenders.
//
// Loaded through one module so every measurement process configures the plugins
// identically - `dayjs.extend` mutates a shared singleton, so doing it per scenario would
// make results depend on which scenario ran first.

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import dayOfYear from 'dayjs/plugin/dayOfYear.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(dayOfYear);

export default dayjs;
