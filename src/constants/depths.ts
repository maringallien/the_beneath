/**
 * depths constants — the full render-depth (z-order) stack, in one file.
 *
 * Every Phaser display-depth the game assigns, gathered here so the layering
 * reads top to bottom in one place: tile layers (0..N) < entities < foreground
 * overlay band < world-space UI (health bars, icons, toasts) < player HUD <
 * boss UI. Most values are defined relative to one another so the ordering
 * invariant survives edits; the foreground band exists to lift specific LDtk
 * tile layers above entities so the player can pass behind them.
 *
 * Inputs:  none — compile-time constants.
 * Outputs: ENTITY_DEPTH, PLAYER_DEPTH, the FOREGROUND_OVERLAY_* and *_HUD/UI depths below.
 * @calledby the level renderer assigning tile-layer depths, and the entity, HUD,
 *           and boss-UI code that sets each display object's render depth.
 * @calls    nothing — a leaf data module.
 */

// All dynamic entities (enemies, projectiles, traps, drops) render above tile layers.
// Foreground layers authored above Entities in LDtk are lifted past this separately.
export const ENTITY_DEPTH = 100;
// One step above so decoration sprites (shops, merchants) never occlude the player.
export const PLAYER_DEPTH = ENTITY_DEPTH + 1;

// Foreground2/3 are authored above the Entities layer in LDtk (pillars, roots the player walks behind),
// so they need a manual depth lift above ENTITY_DEPTH. Foreground1 is below Entities, so it's not listed.
const FOREGROUND_OVERLAY_BASE_DEPTH = ENTITY_DEPTH + 10;
export const FOREGROUND_OVERLAY_LAYER_DEPTHS: Readonly<Record<string, number>> = {
  Foreground2: FOREGROUND_OVERLAY_BASE_DEPTH,
  Foreground3: FOREGROUND_OVERLAY_BASE_DEPTH + 1,
};

// Above player and foreground tiles so health bars stay legible everywhere; the rest of world-space UI chains off this.
export const ENEMY_HEALTH_BAR_DEPTH = FOREGROUND_OVERLAY_BASE_DEPTH + 10;

// One step above the health bar so the two stack cleanly.
export const ENEMY_ALERT_ICON_DEPTH = ENEMY_HEALTH_BAR_DEPTH + 2;

// DOM overlay, so only the depth anchor matters here — the canvas-rendered boss HUD stacks relative to this.
export const PLAYER_HUD_DEPTH = 10_000;

// Boss UI above the player HUD; banner above the bar.
export const BOSS_HUD_DEPTH = PLAYER_HUD_DEPTH + 10;
export const BOSS_BANNER_DEPTH = PLAYER_HUD_DEPTH + 11;

// Above the round banner so the warning always reads on top of the boss UI.
export const BOSS_ESCAPE_DEPTH = BOSS_BANNER_DEPTH + 1;

// Above health bars so the icon is legible when the enemy and interactable overlap.
export const INTERACTION_ICON_DEPTH = ENEMY_HEALTH_BAR_DEPTH + 1;

export const SAVE_TOAST_DEPTH = INTERACTION_ICON_DEPTH + 1;

export const KEY_DOOR_MESSAGE_DEPTH = SAVE_TOAST_DEPTH + 1;
