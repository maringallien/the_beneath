// The full render-depth stack, in one file so the z-order reads top to
// bottom: tile layers (0..N) < entities < foreground overlay band <
// world-space UI (health bars, icons, toasts) < player HUD < boss UI.

// Render depth for the player and other dynamic entities (enemies, projectiles,
// traps, drops). Most tile layers occupy depth 0..N (back→front) by their LDtk
// layer position and sit BELOW this, so entities render in front of the ground
// and background. The exception is the foreground overlay band below: tile
// layers authored ABOVE the Entities layer in LDtk are lifted past this depth
// so they occlude entities (the player passes behind them).
export const ENTITY_DEPTH = 100;
// Player renders one step above other entities so decoration sprites
// (Tech_shop_spawn, Mushroom_merchant, etc.) never occlude the player when
// they overlap. Without this the player and entities tie at ENTITY_DEPTH and
// Phaser falls back to display-list insertion order, which depends on LDtk
// entity processing order and put the shop in front.
export const PLAYER_DEPTH = ENTITY_DEPTH + 1;

// Foreground overlay depth band — sits between the entity bodies above and the
// world-space UI band (ENEMY_HEALTH_BAR_DEPTH and friends) below. The LDtk
// stack places the Entities layer BENEATH Foreground2 and Foreground3, so those
// two tile layers are meant to render IN FRONT of the player and enemies
// (foreground pillars, hanging roots, etc. the player walks behind). But
// dynamic entities use the fixed ENTITY_DEPTH above, which outranks every tile
// layer's natural 0..N depth — so without this lift the foreground renders
// wrongly behind the player. LevelRenderer maps these identifiers to the depths
// here instead of their natural layer depth. Foreground1 is deliberately NOT
// listed: it's authored below the Entities layer, so entities correctly render
// in front of it. Values preserve the LDtk front-to-back order (Foreground3 is
// front-most, so it sits above Foreground2) and stay below the UI band so
// health bars and prompts remain readable over foreground tiles.
const FOREGROUND_OVERLAY_BASE_DEPTH = ENTITY_DEPTH + 10;
export const FOREGROUND_OVERLAY_LAYER_DEPTHS: Readonly<Record<string, number>> = {
  Foreground2: FOREGROUND_OVERLAY_BASE_DEPTH,
  Foreground3: FOREGROUND_OVERLAY_BASE_DEPTH + 1,
};

// Sits above the player AND the foreground overlay band so a health bar stays
// legible whether its enemy jumps in front of the player or stands behind a
// foreground tile layer. The interaction icon, save toast, and key-door message
// all chain off this, so the whole world-space UI band rides above the
// foreground overlay and stays readable over foreground tiles.
export const ENEMY_HEALTH_BAR_DEPTH = FOREGROUND_OVERLAY_BASE_DEPTH + 10;

// Transient overhead "?"/"!" glyph painted above an enemy's head, mirroring the
// health-bar band. One step above the bar so the two stack cleanly.
export const ENEMY_ALERT_ICON_DEPTH = ENEMY_HEALTH_BAR_DEPTH + 2;

// Player HUD: now a DOM/HTML overlay (src/ui/PlayerHudOverlay.ts) styled in
// src/ui/playerHud.css, so its layout and typography live in CSS rather than
// here. Only the depth anchor remains — the boss HUD (still canvas-rendered)
// stacks BOSS_HUD_DEPTH / BOSS_BANNER_DEPTH relative to it, and the value sits
// above every gameplay object including enemy health bars.
export const PLAYER_HUD_DEPTH = 10_000;

// Depths: above the player HUD so the boss UI always reads on top; the
// banner sits above the bar.
export const BOSS_HUD_DEPTH = PLAYER_HUD_DEPTH + 10;
export const BOSS_BANNER_DEPTH = PLAYER_HUD_DEPTH + 11;

// Above the round banner so the warning always reads on top of the boss UI.
export const BOSS_ESCAPE_DEPTH = BOSS_BANNER_DEPTH + 1;

// Renders one step above enemy health bars so the icon is always legible
// when standing next to an enemy that happens to be next to an interactable.
export const INTERACTION_ICON_DEPTH = ENEMY_HEALTH_BAR_DEPTH + 1;

// Renders above the interaction icon so a toast spawned while another save
// is in proximity still reads cleanly.
export const SAVE_TOAST_DEPTH = INTERACTION_ICON_DEPTH + 1;

export const KEY_DOOR_MESSAGE_DEPTH = SAVE_TOAST_DEPTH + 1;
