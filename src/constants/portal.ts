/**
 * @file constants/portal.ts
 * @description Victory exit (Portal_spawn) tuning and warp event names — hold-E to interact, play the one-shot warp clip, vanish the body, then launch VictoryScene.
 * @module constants
 */

// ── Portal interaction ─────────────────────────────────────────────────────
// Hold-E proximity range; tighter than INTERACTION_RANGE_PX so the prompt only appears while standing
// on the portal. Squared form is precomputed for the per-frame distance check.
export const PORTAL_INTERACTION_RANGE_PX = 20;
export const PORTAL_INTERACTION_RANGE_SQ =
  PORTAL_INTERACTION_RANGE_PX * PORTAL_INTERACTION_RANGE_PX;

// Frame index at which the portal "swallows" the player; the body vanishes from this frame onward.
export const PORTAL_WARP_VANISH_FRAME = 1;

// ── Warp scene-bus events ──────────────────────────────────────────────────
// Decouples the Portal entity (plays the clip, emits these) from the scene (owns player-freeze + transition),
// mirroring the save/shop/door pattern. STARTED = freeze player, VANISH = hide body, COMPLETE = launch victory.
export const PORTAL_WARP_STARTED_EVENT = 'portal-warp-started';
export const PORTAL_WARP_VANISH_EVENT = 'portal-warp-vanish';
export const PORTAL_WARP_COMPLETE_EVENT = 'portal-warp-complete';
