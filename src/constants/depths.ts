/**
 * @file constants/depths.ts
 * @description The whole render-depth (z-order) stack in one file — every Phaser display-depth the game assigns, ordered tile layers < entities < foreground band < world-space UI < player HUD < boss UI.
 * @module constants
 */

// ── Entities & foreground band ─────────────────────────────────────────────
// Bottom of the stack above the tile layers (0..N). Dynamic entities (enemies, projectiles, traps, drops)
// render above tiles, with the player one step up so decoration sprites (shops, merchants) never occlude it.
// Foreground2/3 are authored ABOVE the Entities layer in LDtk (pillars, roots the player walks behind), so they
// get a manual lift past ENTITY_DEPTH; Foreground1 is below Entities and isn't listed. Values are relative so
// the ordering invariant survives edits.
export const ENTITY_DEPTH = 100;
export const PLAYER_DEPTH = ENTITY_DEPTH + 1;
const FOREGROUND_OVERLAY_BASE_DEPTH = ENTITY_DEPTH + 10;
export const FOREGROUND_OVERLAY_LAYER_DEPTHS: Readonly<Record<string, number>> = {
  Foreground2: FOREGROUND_OVERLAY_BASE_DEPTH,
  Foreground3: FOREGROUND_OVERLAY_BASE_DEPTH + 1,
};

// ── World-space UI (health bar, alert icon) ────────────────────────────────
// Above the player and foreground tiles so these stay legible everywhere; the rest of the world-space UI
// (interaction icon, toast, key-door message — below) chains off the health-bar depth. Alert icon sits two
// steps above the bar so the two stack cleanly.
export const ENEMY_HEALTH_BAR_DEPTH = FOREGROUND_OVERLAY_BASE_DEPTH + 10;
export const ENEMY_ALERT_ICON_DEPTH = ENEMY_HEALTH_BAR_DEPTH + 2;

// ── Player HUD & boss UI ───────────────────────────────────────────────────
// Top of the stack. The player HUD is a DOM overlay so only its depth anchor matters; the canvas-rendered boss
// UI stacks above it (banner above the bar), and the arena-escape warning sits above the banner so it always reads.
export const PLAYER_HUD_DEPTH = 10_000;
export const BOSS_HUD_DEPTH = PLAYER_HUD_DEPTH + 10;
export const BOSS_BANNER_DEPTH = PLAYER_HUD_DEPTH + 11;
export const BOSS_ESCAPE_DEPTH = BOSS_BANNER_DEPTH + 1;

// ── World-space UI (interaction icon, toast, message) ──────────────────────
// Continues the world-space UI chain off ENEMY_HEALTH_BAR_DEPTH: the interaction icon one step above the bar
// (legible when an enemy and an interactable overlap), then the save toast and key-door message one each above.
export const INTERACTION_ICON_DEPTH = ENEMY_HEALTH_BAR_DEPTH + 1;
export const SAVE_TOAST_DEPTH = INTERACTION_ICON_DEPTH + 1;
export const KEY_DOOR_MESSAGE_DEPTH = SAVE_TOAST_DEPTH + 1;
