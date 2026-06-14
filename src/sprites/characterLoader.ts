import Phaser from 'phaser';
import {
  entityAnimFullKey,
  getEntityAnimByFullKey,
  listEntityRegistryEntries,
} from '../entities/entityRegistryLoader';
import swordMasterRaw from './swordMaster.json';
import swordMasterMagicRaw from './swordMasterMagic.json';
import gunslingerGun1Raw from './gunslingerGun1.json';
import gunslingerGun2Raw from './gunslingerGun2.json';
import gunslingerBodyRaw from './gunslingerBody.json';
import gun1OverlayRaw from './gun1Overlay.json';
import gun2OverlayRaw from './gun2Overlay.json';
import type {
  AnimationStage,
  AnyModeId,
  CharacterModeId,
  CharacterModeRegistry,
  LogicalAnimationKey,
  OverlayModeId,
  ResolvedAnimation,
  SimpleAnimation,
} from './characterTypes';

/**
 * @file sprites/characterLoader.ts
 * @description Resolves the player's per-mode animation registries and builds Phaser spritesheets/animations for both player and JSON-authored entities — owns the mapping from a logical action (idle/run/attack1/…) to a concrete registry key per mode (sword_master, the two gunslinger guns, plus shared body and gun-overlay registries); modes can borrow frames via sourceMode (gun modes share the no-gun body art and overlay a separate gun sprite), the full anim key encodes the owning registry's mode (how the player decides gun-overlay visibility), and keys are namespaced (mode + localKey, entities via entityAnimFullKey) so player and entity textures never collide; the same registry map feeds the in-game "How to Play" previews so they can't drift from the in-game layout.
 * @module sprites
 */

const REGULAR_REGISTRY = swordMasterRaw as CharacterModeRegistry;
const MAGIC_REGISTRY = swordMasterMagicRaw as CharacterModeRegistry;
const GUN1_REGISTRY = gunslingerGun1Raw as CharacterModeRegistry;
const GUN2_REGISTRY = gunslingerGun2Raw as CharacterModeRegistry;
const GUNSLINGER_BODY_REGISTRY = gunslingerBodyRaw as CharacterModeRegistry;
const GUN1_OVERLAY_REGISTRY = gun1OverlayRaw as CharacterModeRegistry;
const GUN2_OVERLAY_REGISTRY = gun2OverlayRaw as CharacterModeRegistry;

const REGISTRIES: ReadonlyArray<CharacterModeRegistry> = [
  REGULAR_REGISTRY,
  MAGIC_REGISTRY,
  GUN1_REGISTRY,
  GUN2_REGISTRY,
  GUNSLINGER_BODY_REGISTRY,
  GUN1_OVERLAY_REGISTRY,
  GUN2_OVERLAY_REGISTRY,
];

export const SWORD_MASTER_MODE: CharacterModeId = 'sword_master';
export const SWORD_MASTER_MAGIC_PREFIX = 'sword_master_magic';
export const DEFAULT_CHARACTER_FPS = 12;

// Wheel-cycled mode order. sword_master_magic is intentionally absent — it's
// a sub-stance of sword_master toggled by F.
export const MODE_ORDER: ReadonlyArray<CharacterModeId> = [
  'sword_master',
  'gunslinger_gun1',
  'gunslinger_gun2',
];

// Per-mode mapping of logical action keys to underlying registry animations.
// `null` = action disabled in this mode (gating in Player.ts must early-return).
// `pauseOnFrame` = freeze on a specific frame after play (turns a multi-frame
// anim into a static pose, e.g., gunslinger uses run frame 0 if idle missing).
type ModeResolverTable = Partial<
  Record<LogicalAnimationKey, ResolvedAnimation | null>
>;

const MODE_RESOLVERS: Record<CharacterModeId, ModeResolverTable> = {
  sword_master: {
    idle: { registryKey: 'idle' },
    run: { registryKey: 'run' },
    fall: { registryKey: 'fall1' },
    wall_slide: { registryKey: 'ledge_slide' },
    attack1: { registryKey: 'attack1' },
    attack2: { registryKey: 'attack2' },
    attack3: { registryKey: 'attack3' },
    attack4: { registryKey: 'attack4' },
    attack5: { registryKey: 'attack5' },
    attack6: { registryKey: 'attack6' },
    dash: { registryKey: 'dash' },
    roll: { registryKey: 'roll' },
    block: { registryKey: 'block' },
    block_idle: { registryKey: 'block_idle' },
    ledge_climb: { registryKey: 'ledge_climb' },
    jump: null,
    death: { registryKey: 'death' },
    take_hit: { registryKey: 'take_hit' },
  },
  // Mixed sourcing per the user's design:
  //   - idle/run/fall/wall_slide/jump → gunslinger_body (no_gun art);
  //     PlayerGun overlays a separate gun sprite on top of these frames.
  //   - death/roll/take_hit/ledge_climb → own gun-mode registry (the gun is
  //     baked into those spritesheets); PlayerGun is hidden during these.
  // attack1 is intentionally null: firing animates the gun overlay only;
  // the body keeps tracking physics state (idle/run/fall) during the shot.
  gunslinger_gun1: {
    idle: { registryKey: 'idle', sourceMode: 'gunslinger_body' },
    run: { registryKey: 'run', sourceMode: 'gunslinger_body' },
    fall: { registryKey: 'fall', sourceMode: 'gunslinger_body' },
    wall_slide: { registryKey: 'ledge_slide', sourceMode: 'gunslinger_body' },
    attack1: null,
    attack2: null,
    attack3: null,
    attack4: null,
    attack5: null,
    attack6: null,
    dash: null,
    roll: { registryKey: 'roll' },
    block: null,
    block_idle: null,
    ledge_climb: { registryKey: 'ledge_grab' },
    jump: { registryKey: 'jump', sourceMode: 'gunslinger_body' },
    death: { registryKey: 'death' },
    take_hit: { registryKey: 'take_hit' },
  },
  gunslinger_gun2: {
    idle: { registryKey: 'idle', sourceMode: 'gunslinger_body' },
    run: { registryKey: 'run', sourceMode: 'gunslinger_body' },
    fall: { registryKey: 'fall', sourceMode: 'gunslinger_body' },
    wall_slide: { registryKey: 'ledge_slide', sourceMode: 'gunslinger_body' },
    attack1: null,
    attack2: null,
    attack3: null,
    attack4: null,
    attack5: null,
    attack6: null,
    dash: null,
    roll: { registryKey: 'roll' },
    block: null,
    block_idle: null,
    ledge_climb: { registryKey: 'ledge_grab' },
    jump: { registryKey: 'jump', sourceMode: 'gunslinger_body' },
    death: { registryKey: 'death' },
    take_hit: { registryKey: 'take_hit' },
  },
};

// Magic attack chain (sub-stance of sword_master). Index = combo step.
// step 1 = roll-attack (magic 'attack1'); steps 2-5 follow the user's spec.
const MAGIC_ATTACK_KEY_BY_STEP: ReadonlyArray<string | null> = [
  null,
  'attack1',
  'attack3',
  'attack4',
  'attack2',
  'attack5',
];

/** A registry's mode prefix, defaulting to 'sword_master' when unset. */
function registryPrefix(registry: CharacterModeRegistry): string {
  return registry.mode ?? 'sword_master';
}

/** Namespaces a registry-local anim key as `<mode>_<localKey>`. */
function fullKeyFor(registry: CharacterModeRegistry, localKey: string): string {
  return `${registryPrefix(registry)}_${localKey}`;
}

// fullKey → animation, indexed across every player registry at module load.
const animationByFullKey: ReadonlyMap<string, SimpleAnimation> = (() => {
  const map = new Map<string, SimpleAnimation>();
  for (const registry of REGISTRIES) {
    for (const anim of Object.values(registry.animations)) {
      map.set(fullKeyFor(registry, anim.key), anim);
    }
  }
  return map;
})();

// fullKey → owning registry's mode. Used by Player to decide gun-overlay
// visibility: if the body's currently-playing anim came from `gunslinger_body`,
// the overlay shows; if it came from a baked-gun registry, the overlay hides.
const animationSourceMode: ReadonlyMap<string, AnyModeId> = (() => {
  const map = new Map<string, AnyModeId>();
  for (const registry of REGISTRIES) {
    const mode = registryPrefix(registry) as AnyModeId;
    for (const anim of Object.values(registry.animations)) {
      map.set(fullKeyFor(registry, anim.key), mode);
    }
  }
  return map;
})();

/** The mode that owns a full anim key, or null if unknown; Player uses it for gun-overlay visibility (gunslinger_body → show; baked-gun → hide). */
export function getAnimationSourceMode(fullAnimKey: string): AnyModeId | null {
  return animationSourceMode.get(fullAnimKey) ?? null;
}

/**
 * @function    animKey
 * @description Resolves a (mode, logical action) to its full anim key, routing through sourceMode when one mode borrows another's spritesheet.
 * @param   mode     The wheel-selectable character mode.
 * @param   logical  The abstract action key Player speaks in.
 * @returns the namespaced full anim key, or null if the action is disabled in that mode.
 * @calledby src/entities/Player.ts, src/entities/Enemy.ts, src/entities/AnimatedEntity.ts, … → picking which clip to play
 * @calls    the per-mode resolver table only
 */
export function animKey(
  mode: CharacterModeId,
  logical: LogicalAnimationKey,
): string | null {
  const resolved = MODE_RESOLVERS[mode][logical];
  if (!resolved) return null;
  const sourceMode = resolved.sourceMode ?? mode;
  return `${sourceMode}_${resolved.registryKey}`;
}

/** True when `logical` is enabled (non-null) in `mode`; Player gating uses this. */
export function isActionAvailable(
  mode: CharacterModeId,
  logical: LogicalAnimationKey,
): boolean {
  return MODE_RESOLVERS[mode][logical] != null;
}

/**
 * @function    magicAttackAnimKey
 * @description Returns the full anim key for a magic combo step, mapping the 1-based step onto its sword_master_magic registry key.
 * @param   step  1-based combo index into the magic-attack chain.
 * @returns the namespaced full anim key; throws if no magic attack is defined for that step.
 * @calledby src/entities/Player.ts, src/ui/manual/combatClips.ts → advancing the magic combo chain
 * @calls    the magic-attack-by-step table only
 */
export function magicAttackAnimKey(step: number): string {
  const localKey = MAGIC_ATTACK_KEY_BY_STEP[step];
  if (!localKey) {
    throw new Error(`No magic attack defined for step ${step}`);
  }
  return `${SWORD_MASTER_MAGIC_PREFIX}_${localKey}`;
}

/**
 * @function    fullKeysForLogical
 * @description Collects every full anim key a logical action maps to across all wheel-selectable modes (deduplicated).
 * @param   logical  The abstract action key.
 * @returns a set of full anim keys (empty if disabled everywhere).
 * @calledby src/entities/Player.ts → recognizing a logical action regardless of active mode (e.g. cross-mode animation-completion handling)
 * @calls    the per-mode key resolver for each mode
 */
export function fullKeysForLogical(
  logical: LogicalAnimationKey,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const mode of Object.keys(MODE_RESOLVERS) as CharacterModeId[]) {
    const key = animKey(mode, logical);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * @function    magicAttackKeySet
 * @description Builds the set of all magic-attack full anim keys, so callers can recognize a magic-attack completion without per-step branching.
 * @returns a set of every magic-attack full anim key.
 * @calledby src/entities/Player.ts → animation-completion handling, telling magic attacks apart from other clips
 * @calls    walks the magic-attack-by-step table
 */
export function magicAttackKeySet(): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const localKey of MAGIC_ATTACK_KEY_BY_STEP) {
    if (localKey) {
      keys.add(`${SWORD_MASTER_MAGIC_PREFIX}_${localKey}`);
    }
  }
  return keys;
}

/**
 * @function    preloadAllCharacters
 * @description Queues a Phaser spritesheet load for every player-registry animation, each at its declared frame geometry.
 * @param   scene  A Phaser scene in its preload phase.
 * @calledby src/scenes/PreloadScene.ts → loading player art at game start
 * @calls    Phaser's spritesheet loader for each indexed animation
 */
export function preloadAllCharacters(scene: Phaser.Scene): void {
  for (const [fullKey, anim] of animationByFullKey) {
    scene.load.spritesheet(fullKey, `/${anim.file}`, {
      frameWidth: anim.frames.frameWidth,
      frameHeight: anim.frames.frameHeight,
    });
  }
}

/** Options for the animation-registration helpers (FPS override for created anims). */
export interface RegisterAnimationsOptions {
  defaultFps?: number;
}

// Origin + physics-body sizing/offset/scale derived for one animation frame, so
// AnimatedEntity and Player place their sprite and hitbox identically.
export interface SpriteAnchor {
  originX: number;
  originY: number;
  // Source-pixel size to pass to body.setSize. Phaser scales body.width to
  // sourceWidth * sprite.scaleX each frame, so dividing by displayScale here
  // keeps the world-space hitbox at PHYSICS_BODY size regardless of scale.
  bodySourceWidth: number;
  bodySourceHeight: number;
  // Source-pixel offset to pass to body.setOffset. Phaser computes
  //   body.position = sprite.position - displayOrigin*scale + offset*scale
  // so offsets are likewise interpreted pre-scale.
  bodyOffsetX: number;
  bodyOffsetY: number;
  // Visual scale to apply via sprite.setScale.
  displayScale: number;
}

// Fallback anchor (centered, zero body, scale 1) returned when an anim key has
// no frame metadata, so callers never deal with a null anchor.
const DEFAULT_ANCHOR: SpriteAnchor = {
  originX: 0.5,
  originY: 0.5,
  bodySourceWidth: 0,
  bodySourceHeight: 0,
  bodyOffsetX: 0,
  bodyOffsetY: 0,
  displayScale: 1,
};

/** A named stage (frame-window marker) within an animation, or undefined if absent. */
export function getAnimationStage(
  fullAnimKey: string,
  stageName: string,
): AnimationStage | undefined {
  return animationByFullKey.get(fullAnimKey)?.stages?.[stageName];
}

/**
 * @function    getAnimationNaturalDurationMs
 * @description Computes an animation's natural playback duration in ms at the default character FPS (frameCount / fps).
 * @param   fullAnimKey  The namespaced player-animation key.
 * @returns the duration in ms, or null if the key is unknown.
 * @calledby src/entities/playerProjectileConfig.ts → timing against a clip's length (e.g. locking an action for its animation's duration)
 * @calls    the player-animation lookup map only
 */
export function getAnimationNaturalDurationMs(
  fullAnimKey: string,
): number | null {
  const anim = animationByFullKey.get(fullAnimKey);
  if (!anim) return null;
  return (anim.frames.frameCount * 1000) / DEFAULT_CHARACTER_FPS;
}

// Frame metadata with optional anchor/scale resolved to rendering defaults
// (anchorX → horizontal centre, anchorY → bottom row, scale → 1). The "How to
// Play" manual's sprite previews draw frames straight to a DOM canvas, so they
// need these raw numbers, not the physics-oriented SpriteAnchor view — read from
// the same registry map so the previews can't drift from the in-game layout.
export interface AnimationFrameInfo {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly displayScale: number;
}

/**
 * @function    getAnimationFrameInfo
 * @description Returns frame metadata for a player animation with anchor/scale resolved to rendering defaults (anchorX → centre, anchorY → bottom row, scale → 1) — the raw numbers the canvas previews need, not the physics-oriented SpriteAnchor view.
 * @param   fullAnimKey  The namespaced player-animation key.
 * @returns the resolved AnimationFrameInfo, or null if the key is unknown.
 * @calledby src/ui/manual/combatClips.ts, src/ui/animatedSpritePreview.ts → the "How to Play" canvas previews drawing frames to a DOM canvas
 * @calls    the player-animation lookup map only
 */
export function getAnimationFrameInfo(
  fullAnimKey: string,
): AnimationFrameInfo | null {
  const anim = animationByFullKey.get(fullAnimKey);
  if (!anim) return null;
  const f = anim.frames;
  return {
    frameWidth: f.frameWidth,
    frameHeight: f.frameHeight,
    frameCount: f.frameCount,
    anchorX: f.anchorX ?? f.frameWidth / 2,
    anchorY: f.anchorY ?? f.frameHeight,
    displayScale: f.displayScale ?? 1,
  };
}

// Normalized frame metadata shared by player registries (SimpleAnimation)
// and the entity registry (AnimatedEntityAnimConfig). Both shapes carry the
// same anchor fields under different nesting; this view lets getSpriteAnchor
// resolve either uniformly so AnimatedEntity reuses the player's anchor math.
interface FrameMetadata {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly anchorX?: number;
  readonly anchorY?: number;
  readonly displayScale?: number;
}

/** Looks up frame metadata for a full anim key — player registry first, entity registry as fallback. */
function lookupFrameMetadata(fullAnimKey: string): FrameMetadata | null {
  const playerAnim = animationByFullKey.get(fullAnimKey);
  if (playerAnim) return playerAnim.frames;
  const entityAnim = getEntityAnimByFullKey(fullAnimKey);
  if (entityAnim) {
    return {
      frameWidth: entityAnim.frameWidth,
      frameHeight: entityAnim.frameHeight,
      anchorX: entityAnim.anchorX,
      anchorY: entityAnim.anchorY,
      displayScale: entityAnim.displayScale,
    };
  }
  return null;
}

/**
 * @function    getSpriteAnchor
 * @description Computes the sprite origin and pre-scale physics-body size/offset from a frame's anchor metadata, so the world-space hitbox stays at the requested size regardless of displayScale; flips horizontally when flipX is set, and falls back to a centered, zero-body default when the key has no metadata.
 * @param   fullAnimKey  Player or entity anim key.
 * @param   bodyWidth    Desired world-space hitbox width in px.
 * @param   bodyHeight   Desired world-space hitbox height in px.
 * @param   flipX        Mirror the anchor horizontally; default false.
 * @returns a SpriteAnchor (origin, source-pixel body size/offset, display scale).
 * @calledby src/entities/Player.ts, src/entities/AnimatedEntity.ts, src/entities/PlayerGun.ts, src/entities/entityRegistryLoader.ts → placing sprite and hitbox identically when the active animation changes
 * @calls    the frame-metadata lookup (player registry first, entity registry fallback)
 */
export function getSpriteAnchor(
  fullAnimKey: string,
  bodyWidth: number,
  bodyHeight: number,
  flipX: boolean = false,
): SpriteAnchor {
  const frame = lookupFrameMetadata(fullAnimKey);
  if (!frame) {
    return DEFAULT_ANCHOR;
  }
  const { frameWidth, frameHeight, anchorX, anchorY, displayScale } = frame;
  const scale = displayScale ?? 1;
  const ax = anchorX ?? frameWidth / 2;
  const ay = anchorY ?? frameHeight;
  const effectiveAx = flipX ? frameWidth - ax : ax;
  // Pre-scale source = body / s (so body.{width,height} = source * s stays at the
  // requested world size); offset = anchor − half-body/(s) seats center/bottom on
  // the anchor. Both reduce to (effectiveAx − bodyWidth/2, ay − bodyHeight) at
  // s = 1, so existing scale-1 JSON renders identically.
  return {
    originX: effectiveAx / frameWidth,
    originY: 0.5,
    bodySourceWidth: bodyWidth / scale,
    bodySourceHeight: bodyHeight / scale,
    bodyOffsetX: effectiveAx - bodyWidth / (2 * scale),
    bodyOffsetY: ay - bodyHeight / scale,
    displayScale: scale,
  };
}

/**
 * @function    registerAllCharacterAnimations
 * @description Creates Phaser Animations for every player-registry animation, honoring poseFrame (a single static pinned frame) and the loop flag; idempotent, skipping keys that already exist.
 * @param   scene    A Phaser scene, after spritesheets have loaded.
 * @param   options  Optional defaultFps override; falls back to the character default.
 * @calledby src/scenes/PreloadScene.ts → once player spritesheets are loaded
 * @calls    Phaser's animation manager (exists / generateFrameNumbers / create)
 */
export function registerAllCharacterAnimations(
  scene: Phaser.Scene,
  options: RegisterAnimationsOptions = {},
): void {
  const fps = options.defaultFps ?? DEFAULT_CHARACTER_FPS;
  for (const [fullKey, anim] of animationByFullKey) {
    if (scene.anims.exists(fullKey)) continue;
    // A poseFrame pins the anim to a single static frame of the sheet (e.g.
    // block_idle holds frame 5 of the 6-frame block strip). repeat:-1 on a
    // 1-frame anim just holds it and never emits ANIMATION_COMPLETE.
    const pose = anim.frames.poseFrame;
    const range =
      pose !== undefined
        ? { start: pose, end: pose }
        : { start: 0, end: anim.frames.frameCount - 1 };
    scene.anims.create({
      key: fullKey,
      frames: scene.anims.generateFrameNumbers(fullKey, range),
      frameRate: fps,
      repeat: anim.loops ? -1 : 0,
    });
  }
}

// The two gun modes that fire projectiles.
export type GunslingerProjectileMode = 'gunslinger_gun1' | 'gunslinger_gun2';
// Projectile lifecycle animations: in-flight idle vs. on-impact explode.
export type ProjectileAnimKind = 'idle' | 'explode';

/** Full anim key for a projectile state, e.g. `gunslinger_gun1_projectile_idle`. */
export function projectileAnimKey(
  mode: GunslingerProjectileMode,
  kind: ProjectileAnimKind,
): string {
  return `${mode}_projectile_${kind}`;
}

// Maps a wheel-selectable gun mode to the matching gun-overlay registry mode.
// Kept as a function (not a constant union) so a future overlay swap (e.g.
// reskinning gun1) only needs to update this map.
const GUN_OVERLAY_MODE_BY_GUN: Readonly<
  Record<GunslingerProjectileMode, OverlayModeId>
> = {
  gunslinger_gun1: 'gun1_overlay',
  gunslinger_gun2: 'gun2_overlay',
};

/** The overlay registry mode that paints a given gun mode's gun sprite (called internally by gunOverlayAnimKey). */
export function gunOverlayModeFor(
  mode: GunslingerProjectileMode,
): OverlayModeId {
  return GUN_OVERLAY_MODE_BY_GUN[mode];
}

// Gun-overlay animations: resting idle vs. the firing attack.
export type GunOverlayAnimKind = 'idle' | 'attack1';

/** Full anim key for a gun-overlay state, e.g. `gun1_overlay_attack1`. */
export function gunOverlayAnimKey(
  mode: GunslingerProjectileMode,
  kind: GunOverlayAnimKind,
): string {
  return `${gunOverlayModeFor(mode)}_${kind}`;
}

/**
 * @function    preloadAllEntities
 * @description Queues spritesheet loads for every JSON-authored entity animation, under its iid-namespaced full key.
 * @param   scene  A Phaser scene in its preload phase.
 * @calledby src/scenes/PreloadScene.ts, src/entities/AnimatedEntity.ts → loading entity art at game start
 * @calls    the entity-registry enumerator, the full-key namespacing helper, and Phaser's spritesheet loader
 */
export function preloadAllEntities(scene: Phaser.Scene): void {
  for (const { identifier, config } of listEntityRegistryEntries()) {
    for (const [animKey, anim] of Object.entries(config.animations)) {
      const fullKey = entityAnimFullKey(identifier, animKey);
      scene.load.spritesheet(fullKey, `/${anim.file}`, {
        frameWidth: anim.frameWidth,
        frameHeight: anim.frameHeight,
      });
    }
  }
}

/**
 * @function    registerAllEntityAnimations
 * @description Creates Phaser Animations for every entity-registry animation, honoring each anim's loop flag (loops default true; one-shots like 'death' set loops:false in JSON); idempotent and must run after the entity spritesheets have loaded.
 * @param   scene    A Phaser scene, after entity spritesheets have loaded.
 * @param   options  Optional defaultFps override.
 * @calledby src/scenes/PreloadScene.ts → once entity spritesheets are loaded
 * @calls    the entity-registry enumerator, the full-key namespacing helper, and Phaser's animation manager (exists / generateFrameNumbers / create)
 */
export function registerAllEntityAnimations(
  scene: Phaser.Scene,
  options: RegisterAnimationsOptions = {},
): void {
  const fps = options.defaultFps ?? DEFAULT_CHARACTER_FPS;
  for (const { identifier, config } of listEntityRegistryEntries()) {
    for (const [animKey, anim] of Object.entries(config.animations)) {
      const fullKey = entityAnimFullKey(identifier, animKey);
      if (scene.anims.exists(fullKey)) continue;
      scene.anims.create({
        key: fullKey,
        frames: scene.anims.generateFrameNumbers(fullKey, {
          start: 0,
          end: anim.frameCount - 1,
        }),
        frameRate: fps,
        // anim.loops defaults to true in entityRegistryLoader; -1 = infinite
        // repeat. One-shot animations like 'death' set loops:false in JSON.
        repeat: anim.loops ? -1 : 0,
      });
    }
  }
}
