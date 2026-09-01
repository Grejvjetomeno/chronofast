// The benchmark needs one namespace carrying both the internal raw layer and the public
// classes, matching how v1 exposes everything from a single module.
//
// It MUST be built with `export *`, not object spread. chronoFast returns multi-value
// results through module-scoped scratch slots (cY, cM, cD, ...), and those are ES module
// LIVE BINDINGS. Spreading a namespace copies the values at spread time, freezing the
// slots at 0 - which is exactly the mismatch the correctness gate caught.
export * from '../lib/core.js';
export * from '../lib/zone.js';
export { ChronoInstant, ChronoZoned } from '../lib/index.js';
