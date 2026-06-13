/**
 * constants — public barrel for the game's tuning values, split by domain.
 *
 * The single import surface for all tuning constants: every call site imports
 * `from '.../constants'`, so adding a constant means dropping it in the matching
 * domain file below and the wildcard re-export picks it up automatically. Render
 * depths are grouped in depths.ts (the z-stack reads top-to-bottom there);
 * everything else lives with the system it tunes.
 *
 * Inputs:  re-exports only — no values of its own.
 * Outputs: every constant from the domain modules listed below.
 * @calledby anything that needs a tuning value.
 * @calls    the per-domain constant modules it re-exports.
 */
export * from './audio';
export * from './boss';
export * from './combat';
export * from './depths';
export * from './enemies';
export * from './physics';
export * from './pickups';
export * from './player';
export * from './portal';
export * from './rendering';
export * from './scenes';
export * from './screens';
export * from './shop';
export * from './ui';
