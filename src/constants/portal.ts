/**
 * portal constants — Portal_spawn tuning and warp event names.
 *
 * Pure data (no logic) for the game's victory exit: standing on the portal shows
 * the hold-E prompt; interacting plays the one-shot `warp` clip; the player body
 * vanishes partway through; the clip's completion launches the VictoryScene. The
 * Portal entity only plays the clip and emits the events below, while the scene
 * owns the player-freeze and scene transition — so the two stay decoupled
 * (mirrors the save/shop/door pattern). Re-exported through the constants barrel.
 *
 * Inputs:  none — compile-time constants and event-name strings.
 * Outputs: the trigger radius, the vanish frame, and the warp event names below.
 * @calledby the portal entity and the scene's victory-warp handling.
 * @calls    nothing — a leaf data module.
 */

// Tighter than INTERACTION_RANGE_PX so the prompt only appears when standing on the portal.
export const PORTAL_INTERACTION_RANGE_PX = 20;
export const PORTAL_INTERACTION_RANGE_SQ =
  PORTAL_INTERACTION_RANGE_PX * PORTAL_INTERACTION_RANGE_PX;

// Frame index at which the portal "swallows" the player; body vanishes from this frame onward.
export const PORTAL_WARP_VANISH_FRAME = 1;

// Scene-bus events: STARTED = freeze player, VANISH = hide body, COMPLETE = launch victory screen.
export const PORTAL_WARP_STARTED_EVENT = 'portal-warp-started';
export const PORTAL_WARP_VANISH_EVENT = 'portal-warp-vanish';
export const PORTAL_WARP_COMPLETE_EVENT = 'portal-warp-complete';
