import Phaser from 'phaser';
import {
  getAllSoundDefinitions,
  getAmbienceForLevel,
  getEntityPeriodicSoundBindings,
  getEntitySoundIds,
  getEntitySoundSequence,
  getEntityWalkSoundBindings,
  getGlobalAmbienceIds,
  getMovingEntitySoundIds,
  getPlayerStateSoundId,
  getSoundDefinition,
} from './soundRegistryLoader';
import type {
  PlayerSoundSlot,
  SpatialConfig,
  WalkSoundSurface,
} from './soundRegistryTypes';

/**
 * @file audio/SoundManager.ts
 * @description The game's whole audio runtime — free functions over module-level maps (no class). Owns level-ambience crossfades, player-state loops (footsteps/cloth/falling-whoosh), per-entity spatial loops (static decoration + moving creatures + state-gated enemy footsteps + playlists), periodic creature one-shots, and fire-and-forget one-shots. Phaser's sound manager is game-scoped, so every BaseSound outlives any one scene and the module state keeps audio correct across scene.restart (respawn re-runs create() but the maps persist, so ambience never resets). Audio-thread budget is first-class (this game has hit saturation): idle loops are PAUSED not just muted, out-of-earshot sources are distance-culled with a hysteresis margin, and one-shots are freed on COMPLETE/STOP plus a duration safety net. Falloff is one linear band everywhere: full inside minRadius, zero past maxRadius, lerped between. Driven by the preloader, the gameplay scene (level load / per frame / transition), the player's movement-combat code, and the enemy spawn/death lifecycle. Most exports take a pervasive `scene: Phaser.Scene` (the active scene; scene.sound is game-global regardless), omitted from per-function @param lists.
 * @module audio
 */

// structural type for anything that has a live world position (keeps SoundManager decoupled from Phaser sprites)
export interface PositionedGameObject extends Phaser.GameObjects.GameObject {
  readonly x: number;
  readonly y: number;
}

// 1.5s crossfade on level transition — slow enough to feel intentional, fast enough for level-hopping
export const AMBIENCE_CROSSFADE_MS = 1500;

// 120ms crossfade for player-state loops — snappy enough to track walk start/stop without clicks
export const PLAYER_STATE_CROSSFADE_MS = 120;

// live BaseSound map; game-scoped so it survives scene restarts (respawn re-runs create() but this persists)
const ACTIVE: Map<string, Phaser.Sound.BaseSound> = new Map();

// ids currently at (or fading to) full volume; diffed against the next level's set on transition
let currentAmbienceIds: ReadonlyArray<string> = [];

// last level id we applied ambience for; null = cold-start
let currentLevelId: string | null = null;

// global tracks are muted-not-destroyed on fade-out, so re-entry to a global-ambience level just fades them back up
const GLOBAL_AMBIENCE_SET: ReadonlySet<string> = new Set(getGlobalAmbienceIds());

/**
 * @function    preloadAll
 * @description Queues every registry sound with Phaser's loader; skips already-cached ids so a second pass is harmless.
 * @calledby src/scenes/PreloadScene.ts → the preload pipeline at game load, before any playback
 * @calls    getAllSoundDefinitions and Phaser's audio loader
 */
export function preloadAll(scene: Phaser.Scene): void {
  for (const [id, def] of getAllSoundDefinitions()) {
    // Don't double-queue — Phaser's loader throws on duplicate keys.
    if (scene.cache.audio.exists(id)) {
      continue;
    }
    scene.load.audio(id, def.path);
  }
}

/**
 * @function    setLevelAmbience
 * @description Crossfades to the new level's ambience set — outgoing global tracks mute-and-keep (re-entry just fades them back up), outgoing non-globals stop-and-destroy; idempotent for the same level.
 * @param   levelId  Target level, or null for the global default ambience.
 * @calledby src/scenes/GameScene.ts → level load and level transition
 * @calls    getGlobalAmbienceIds/getAmbienceForLevel/getSoundDefinition, the fadeSound primitive, and Phaser's sound manager (add/play/stop/destroy)
 */
export function setLevelAmbience(
  scene: Phaser.Scene,
  levelId: string | null,
): void {
  if (currentLevelId === levelId) {
    return;
  }
  const desired = levelId === null
    ? getGlobalAmbienceIds()
    : getAmbienceForLevel(levelId);

  const currentSet = new Set(currentAmbienceIds);
  const desiredSet = new Set(desired);

  // Outgoing: was in current, not in desired → fade down.
  for (const id of currentSet) {
    if (desiredSet.has(id)) continue;
    const sound = ACTIVE.get(id);
    if (sound === undefined) continue;
    const isGlobal = GLOBAL_AMBIENCE_SET.has(id);
    fadeSound(scene, sound, 0, isGlobal ? undefined : () => {
      // Non-global: destroy once silenced so the next entry restarts it from
      // the beginning. Re-check ownership to guard a late tween-completion that
      // lands after re-entry already recreated the instance.
      if (ACTIVE.get(id) === sound) {
        sound.stop();
        sound.destroy();
        ACTIVE.delete(id);
      }
    });
  }

  // Incoming: in desired, not in current → fade up (or start fresh).
  for (const id of desiredSet) {
    if (currentSet.has(id)) continue;
    const def = getSoundDefinition(id);
    if (def === null) continue;
    let sound = ACTIVE.get(id);
    if (sound === undefined) {
      sound = scene.sound.add(id, {
        loop: def.loop,
        volume: 0,
        rate: def.rate ?? 1,
      });
      sound.play();
      ACTIVE.set(id, sound);
    }
    fadeSound(scene, sound, def.defaultVolume);
  }

  currentAmbienceIds = desired;
  currentLevelId = levelId;
}

/**
 * @function    setMasterVolume
 * @description Sets the global master volume, which Phaser multiplies by each track's own volume.
 * @param   value  Target volume; clamped to [0, 1].
 * @calledby — (exported via the audio barrel as the master-volume API; no in-repo caller)
 * @calls    nothing beyond writing Phaser's sound-manager volume
 */
export function setMasterVolume(scene: Phaser.Scene, value: number): void {
  const clamped = Math.max(0, Math.min(1, value));
  scene.sound.volume = clamped;
}

// keyed by "iid:soundId"; static anchors hold world coords, moving anchors hold a live sprite ref
interface EntitySoundAnchor {
  readonly sound: Phaser.Sound.BaseSound;
  readonly spatial: SpatialConfig;
  readonly defaultVolume: number;
  // false = silenced regardless of distance; walk anchors start false and flip with chase state
  enabled: boolean;
  // walk anchors only: 'always' plays while walking, 'ground'/'bridge' gate on the tile underfoot
  readonly surface?: WalkSoundSurface;
  readonly source:
    | { readonly kind: 'static'; readonly x: number; readonly y: number }
    | { readonly kind: 'moving'; readonly sprite: PositionedGameObject };
}
const ENTITY_ANCHORS: Map<string, EntitySoundAnchor> = new Map();

// cached each frame by updateEntitySounds; periodic timers read this to gate off-screen emitters
let lastPlayerX = 0;
let lastPlayerY = 0;

// per-(sprite, soundId) timers; tracked so death/rebuild can cancel pending fires
const PERIODIC_TIMERS: Map<string, Phaser.Time.TimerEvent> = new Map();
// surrogate numeric ids for sprites (WeakMap so destroyed sprites don't leak)
let periodicIdCounter = 0;
const SPRITE_IDS: WeakMap<PositionedGameObject, string> = new WeakMap();
/** Get-or-mint a stable surrogate string id for a sprite (used to key its anchors/timers). */
function getSpriteId(sprite: PositionedGameObject): string {
  let id = SPRITE_IDS.get(sprite);
  if (id === undefined) {
    id = `sprite#${++periodicIdCounter}`;
    SPRITE_IDS.set(sprite, id);
  }
  return id;
}

// reverse indices so unregisterEntityAudio can cut audio at the killing blow rather than waiting for the destroy event
const MOVING_ANCHOR_KEYS_BY_SPRITE: WeakMap<
  PositionedGameObject,
  string[]
> = new WeakMap();
const PERIODIC_TIMER_KEYS_BY_SPRITE: WeakMap<
  PositionedGameObject,
  string[]
> = new WeakMap();
// static-anchor reverse index by iid so an enemy death (e.g. hive) stops its loops immediately
const STATIC_ANCHOR_KEYS_BY_IID: Map<string, string[]> = new Map();

// small pitch jitter so layered crow/wasp copies don't comb-filter into a "hollow whoosh"
const MOVING_RATE_JITTER = 0.08;
/** Applies ±MOVING_RATE_JITTER to a base rate to decorrelate layered copies of the same sound. */
function jitteredRate(base: number): number {
  const jitter = 1 - MOVING_RATE_JITTER + Math.random() * MOVING_RATE_JITTER * 2;
  return base * jitter;
}

/**
 * @function    registerEntitySound
 * @description Registers fixed-position spatial loops for an immovable LDtk entity; idempotent per (iid, soundId), with a random seek so layered copies don't comb-filter.
 * @param   entityIdentifier  LDtk type to look up bindings for.
 * @param   iid               This instance's unique id — the dedup / teardown key.
 * @param   worldX            Fixed anchor X (world px).
 * @param   worldY            Fixed anchor Y (world px).
 * @calledby src/scenes/GameScene.ts and src/level/BossEncounterController.ts → world build, for static sound-emitting props
 * @calls    getEntitySoundIds/getSoundDefinition and Phaser's sound manager (add/play)
 */
export function registerEntitySound(
  scene: Phaser.Scene,
  entityIdentifier: string,
  iid: string,
  worldX: number,
  worldY: number,
): void {
  const soundIds = getEntitySoundIds(entityIdentifier);
  const newKeysForIid: string[] = [];
  for (const soundId of soundIds) {
    const anchorKey = `${iid}:${soundId}`;
    if (ENTITY_ANCHORS.has(anchorKey)) continue;
    const def = getSoundDefinition(soundId);
    if (def === null || def.spatial === undefined) continue;

    const sound = scene.sound.add(soundId, {
      loop: def.loop,
      volume: 0,
      rate: def.rate ?? 1,
    });
    // duration may not be set yet even after preload; fall back to 0 (start of track)
    const duration = sound.duration ?? 0;
    const seek = duration > 0 ? Math.random() * duration : 0;
    sound.play({ seek });
    ENTITY_ANCHORS.set(anchorKey, {
      sound,
      spatial: def.spatial,
      defaultVolume: def.defaultVolume,
      enabled: true,
      source: { kind: 'static', x: worldX, y: worldY },
    });
    newKeysForIid.push(anchorKey);
  }
  if (newKeysForIid.length === 0) return;
  const existing = STATIC_ANCHOR_KEYS_BY_IID.get(iid);
  if (existing) {
    existing.push(...newKeysForIid);
  } else {
    STATIC_ANCHOR_KEYS_BY_IID.set(iid, newKeysForIid);
  }
}

/**
 * @function    registerMovingEntitySound
 * @description Like registerEntitySound, but stores a live sprite ref so the per-frame update tracks the creature's moving position; rate is jittered to decorrelate layered copies.
 * @param   entityIdentifier  LDtk type to look up bindings for.
 * @param   sprite            The live creature whose position drives falloff.
 * @calledby src/scenes/GameScene.ts → enemy/creature spawn, for ambient-noise creatures (wasps, crows)
 * @calls    getMovingEntitySoundIds/getSoundDefinition, Phaser's sound manager, and the sprite's DESTROY teardown (tearDownMovingAnchorKeys)
 */
export function registerMovingEntitySound(
  scene: Phaser.Scene,
  entityIdentifier: string,
  sprite: PositionedGameObject,
): void {
  const soundIds = getMovingEntitySoundIds(entityIdentifier);
  if (soundIds.length === 0) return;
  const spriteId = getSpriteId(sprite);
  const anchorKeys: string[] = [];
  for (const soundId of soundIds) {
    const anchorKey = `${spriteId}:${soundId}`;
    if (ENTITY_ANCHORS.has(anchorKey)) continue;
    const def = getSoundDefinition(soundId);
    if (def === null || def.spatial === undefined) continue;

    const sound = scene.sound.add(soundId, {
      loop: def.loop,
      volume: 0,
      rate: jitteredRate(def.rate ?? 1),
    });
    const duration = sound.duration ?? 0;
    const seek = duration > 0 ? Math.random() * duration : 0;
    sound.play({ seek });
    ENTITY_ANCHORS.set(anchorKey, {
      sound,
      spatial: def.spatial,
      defaultVolume: def.defaultVolume,
      enabled: true,
      source: { kind: 'moving', sprite },
    });
    anchorKeys.push(anchorKey);
  }
  if (anchorKeys.length === 0) return;
  MOVING_ANCHOR_KEYS_BY_SPRITE.set(sprite, anchorKeys);
  // DESTROY is the fallback; death-state unregister usually fires first, but this covers HMR/shutdown paths
  sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
    tearDownMovingAnchorKeys(sprite);
  });
}

/**
 * @function    tearDownMovingAnchorKeys
 * @description Stops and destroys every moving/walk anchor a sprite owns, then clears its moving + walk anchor indices.
 * @param   sprite  The sprite whose anchors to tear down.
 * @calledby the sprite DESTROY handler and unregisterEntityAudio
 * @calls    Phaser stop/destroy on each anchor's voice
 */
function tearDownMovingAnchorKeys(sprite: PositionedGameObject): void {
  const anchorKeys = MOVING_ANCHOR_KEYS_BY_SPRITE.get(sprite);
  if (!anchorKeys) return;
  for (const key of anchorKeys) {
    const anchor = ENTITY_ANCHORS.get(key);
    if (!anchor) continue;
    anchor.sound.stop();
    anchor.sound.destroy();
    ENTITY_ANCHORS.delete(key);
  }
  MOVING_ANCHOR_KEYS_BY_SPRITE.delete(sprite);
  WALK_ANCHOR_KEYS_BY_SPRITE.delete(sprite);
}

// O(1) lookup for walk anchors per sprite; walk anchors also live in MOVING_ANCHOR_KEYS_BY_SPRITE for teardown
const WALK_ANCHOR_KEYS_BY_SPRITE: WeakMap<PositionedGameObject, string[]> =
  new WeakMap();

/**
 * @function    registerEnemyWalkSound
 * @description Registers walk-sound loops for an enemy — each starts muted and paused (an idle enemy costs nothing) and resumes mid-cycle when chase state enables it; reuses the moving-anchor index for teardown.
 * @param   entityIdentifier  LDtk type to look up walk bindings for.
 * @param   sprite            The enemy the footsteps follow.
 * @calledby src/scenes/GameScene.ts → enemy spawn, for enemies with footstep bindings
 * @calls    getEntityWalkSoundBindings/getSoundDefinition and Phaser's sound manager (add/play/pause)
 */
export function registerEnemyWalkSound(
  scene: Phaser.Scene,
  entityIdentifier: string,
  sprite: PositionedGameObject,
): void {
  const bindings = getEntityWalkSoundBindings(entityIdentifier);
  if (bindings.length === 0) return;
  const spriteId = getSpriteId(sprite);
  const newAnchorKeys: string[] = [];
  for (const binding of bindings) {
    const anchorKey = `${spriteId}:${binding.soundId}`;
    if (ENTITY_ANCHORS.has(anchorKey)) continue;
    const def = getSoundDefinition(binding.soundId);
    // loader guarantees spatial+loop; these are guard rails for manual registry edits
    if (def === null || def.spatial === undefined || !def.loop) continue;

    const sound = scene.sound.add(binding.soundId, {
      loop: true,
      volume: 0,
      rate: jitteredRate(def.rate ?? 1),
    });
    const duration = sound.duration ?? 0;
    const seek = duration > 0 ? Math.random() * duration : 0;
    sound.play({ seek });
    // pause immediately so an idle enemy's loop costs nothing; the seek offset is retained as phase
    sound.pause();
    ENTITY_ANCHORS.set(anchorKey, {
      sound,
      spatial: def.spatial,
      defaultVolume: def.defaultVolume,
      enabled: false,
      surface: binding.surface,
      source: { kind: 'moving', sprite },
    });
    newAnchorKeys.push(anchorKey);
  }
  if (newAnchorKeys.length === 0) return;
  const existingWalk = WALK_ANCHOR_KEYS_BY_SPRITE.get(sprite);
  if (existingWalk) {
    existingWalk.push(...newAnchorKeys);
  } else {
    WALK_ANCHOR_KEYS_BY_SPRITE.set(sprite, newAnchorKeys);
  }
  // reuse the moving-anchor index so walk sounds tear down via the same destroy/unregister paths
  const existing = MOVING_ANCHOR_KEYS_BY_SPRITE.get(sprite);
  if (existing) {
    existing.push(...newAnchorKeys);
  } else {
    MOVING_ANCHOR_KEYS_BY_SPRITE.set(sprite, [...newAnchorKeys]);
    sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
      tearDownMovingAnchorKeys(sprite);
    });
  }
}

/**
 * @function    setEnemyWalkSoundEnabled
 * @description Flips the enabled flags on an enemy's walk anchors; the next per-frame update applies the actual pause/resume (so this hot path can't thrash the distance cull). Surface-gated anchors only enable when the tile underfoot matches.
 * @param   sprite   The enemy whose walk anchors to flip.
 * @param   enabled  Whether footsteps should play.
 * @param   surface  'ground' | 'bridge' | null — the tile underfoot, for gating surface-specific bindings.
 * @calledby src/entities/Enemy.ts → chase/movement logic each time walk state or surface changes
 * @calls    nothing beyond reading the walk-anchor index and setting flags
 */
export function setEnemyWalkSoundEnabled(
  sprite: PositionedGameObject,
  enabled: boolean,
  surface: 'ground' | 'bridge' | null = null,
): void {
  const anchorKeys = WALK_ANCHOR_KEYS_BY_SPRITE.get(sprite);
  if (anchorKeys === undefined) return;
  for (const key of anchorKeys) {
    const anchor = ENTITY_ANCHORS.get(key);
    if (!anchor) continue;
    if (!enabled) {
      anchor.enabled = false;
    } else if (anchor.surface === undefined || anchor.surface === 'always') {
      anchor.enabled = true;
    } else {
      anchor.enabled = anchor.surface === surface;
    }
  }
  // flag only — the per-frame update owns pause/resume so this hot path can't thrash the distance cull
}

// per-sprite playlist that advances on COMPLETE, wraps, and pause/resumes mid-clip on interruption
interface EntitySoundSequenceState {
  readonly scene: Phaser.Scene;
  readonly sprite: PositionedGameObject;
  readonly soundIds: ReadonlyArray<string>;
  readonly defaultVolume: number;
  readonly spatial: SpatialConfig;
  // wraps mod soundIds.length on COMPLETE
  currentIndex: number;
  // null only in the gap between COMPLETE-while-paused and resume
  currentSound: Phaser.Sound.BaseSound | null;
  isPaused: boolean;
}

const SEQUENCE_STATES: Map<PositionedGameObject, EntitySoundSequenceState> =
  new Map();

/**
 * @function    registerEntitySoundSequence
 * @description Starts an entity's sound-sequence playlist at index 0; idempotent (scene.restart safe) and a no-op if the entity has no sequence.
 * @param   entityIdentifier  LDtk type to look up the sequence for.
 * @param   sprite            The creature the playlist follows.
 * @calledby src/scenes/GameScene.ts → creature spawn, for entities with an authored sound sequence
 * @calls    getEntitySoundSequence/getSoundDefinition, then playCurrentSequenceClip (which advances on COMPLETE)
 */
export function registerEntitySoundSequence(
  scene: Phaser.Scene,
  entityIdentifier: string,
  sprite: PositionedGameObject,
): void {
  const soundIds = getEntitySoundSequence(entityIdentifier);
  if (soundIds.length === 0) return;
  if (SEQUENCE_STATES.has(sprite)) return;
  const firstDef = getSoundDefinition(soundIds[0]);
  if (firstDef === null || firstDef.spatial === undefined) return;

  const state: EntitySoundSequenceState = {
    scene,
    sprite,
    soundIds,
    defaultVolume: firstDef.defaultVolume,
    spatial: firstDef.spatial,
    currentIndex: 0,
    currentSound: null,
    isPaused: false,
  };
  SEQUENCE_STATES.set(sprite, state);
  playCurrentSequenceClip(state);

  sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
    tearDownEntitySoundSequence(sprite);
  });
}

/**
 * @function    playCurrentSequenceClip
 * @description Plays the playlist's current clip at volume 0 and wires COMPLETE to advance (and wrap) to the next; stays put while paused. A late COMPLETE after teardown is guarded by an identity check.
 * @param   state  The playlist state whose currentIndex clip to start.
 * @calledby registerEntitySoundSequence, resumeEntitySoundSequence, and its own COMPLETE handler
 * @calls    getSoundDefinition and Phaser's sound manager (add/play), re-entering itself on COMPLETE
 */
function playCurrentSequenceClip(state: EntitySoundSequenceState): void {
  const soundId = state.soundIds[state.currentIndex];
  const def = getSoundDefinition(soundId);
  if (def === null) return;
  const sound = state.scene.sound.add(soundId, {
    loop: false,
    volume: 0,
    rate: def.rate ?? 1,
  });
  sound.once(Phaser.Sound.Events.COMPLETE, () => {
    // guard a late COMPLETE arriving after teardown (map check is robust; teardown nulls currentSound)
    if (SEQUENCE_STATES.get(state.sprite) !== state) {
      sound.destroy();
      return;
    }
    sound.destroy();
    state.currentSound = null;
    state.currentIndex = (state.currentIndex + 1) % state.soundIds.length;
    if (!state.isPaused) {
      playCurrentSequenceClip(state);
    }
  });
  state.currentSound = sound;
  sound.play();
}

/**
 * @function    pauseEntitySoundSequence
 * @description Pauses a sprite's sequence at its current clip position so resume picks up exactly where it left off; no-op if absent or already paused.
 * @param   sprite  The creature whose playlist to pause.
 * @calledby src/entities/Enemy.ts → when a sequenced creature should fall silent (off-screen, dormant) without losing position
 * @calls    Phaser's pause on the current clip
 */
export function pauseEntitySoundSequence(sprite: PositionedGameObject): void {
  const state = SEQUENCE_STATES.get(sprite);
  if (!state || state.isPaused) return;
  state.isPaused = true;
  if (state.currentSound && state.currentSound.isPlaying) {
    state.currentSound.pause();
  }
}

/**
 * @function    resumeEntitySoundSequence
 * @description Resumes a paused sequence; if the pause landed in the gap between clips, starts the next clip instead. No-op if absent or not paused.
 * @param   sprite  The creature whose playlist to resume.
 * @calledby src/entities/Enemy.ts → when a previously-paused sequenced creature should sound again
 * @calls    Phaser's resume, or playCurrentSequenceClip when between clips
 */
export function resumeEntitySoundSequence(sprite: PositionedGameObject): void {
  const state = SEQUENCE_STATES.get(sprite);
  if (!state || !state.isPaused) return;
  state.isPaused = false;
  if (state.currentSound && state.currentSound.isPaused) {
    state.currentSound.resume();
  } else if (state.currentSound === null) {
    playCurrentSequenceClip(state);
  }
}

/**
 * @function    tearDownEntitySoundSequence
 * @description Stops/destroys the active clip and removes the playlist state for a sprite.
 * @param   sprite  The sprite whose sequence to tear down.
 * @calledby the sprite DESTROY handler and unregisterEntityAudio
 * @calls    Phaser stop/destroy on the current clip
 */
function tearDownEntitySoundSequence(sprite: PositionedGameObject): void {
  const state = SEQUENCE_STATES.get(sprite);
  if (!state) return;
  if (state.currentSound) {
    state.currentSound.stop();
    state.currentSound.destroy();
    state.currentSound = null;
  }
  SEQUENCE_STATES.delete(sprite);
}

/**
 * @function    tearDownPeriodicTimerKeys
 * @description Cancels every pending periodic timer for a sprite so no fire lands on a destroyed voice.
 * @param   sprite  The sprite whose periodic timers to cancel.
 * @calledby the sprite DESTROY handler and unregisterEntityAudio
 * @calls    Phaser TimerEvent.remove on each pending timer
 */
function tearDownPeriodicTimerKeys(sprite: PositionedGameObject): void {
  const timerKeys = PERIODIC_TIMER_KEYS_BY_SPRITE.get(sprite);
  if (!timerKeys) return;
  for (const key of timerKeys) {
    const timer = PERIODIC_TIMERS.get(key);
    if (timer) timer.remove(false);
    PERIODIC_TIMERS.delete(key);
  }
  PERIODIC_TIMER_KEYS_BY_SPRITE.delete(sprite);
}

/**
 * @function    tearDownStaticAnchorKeysByIid
 * @description Stops/destroys the static anchors owned by a dying enemy (e.g. a hive's bee buzz), keyed by LDtk iid.
 * @param   iid  The LDtk instance id whose static anchors to tear down.
 * @calledby unregisterEntityAudio, when an iid is supplied
 * @calls    Phaser stop/destroy on each anchor's voice
 */
function tearDownStaticAnchorKeysByIid(iid: string): void {
  const anchorKeys = STATIC_ANCHOR_KEYS_BY_IID.get(iid);
  if (!anchorKeys) return;
  for (const key of anchorKeys) {
    const anchor = ENTITY_ANCHORS.get(key);
    if (!anchor) continue;
    anchor.sound.stop();
    anchor.sound.destroy();
    ENTITY_ANCHORS.delete(key);
  }
  STATIC_ANCHOR_KEYS_BY_IID.delete(iid);
}

/**
 * @function    unregisterEntityAudio
 * @description Cuts all audio an entity owns at the killing blow — moving/walk anchors, periodic timers, sequence playlist, and (if an iid is given) its static anchors — rather than waiting for the death animation to end.
 * @param   sprite  The dying entity.
 * @param   iid     Optional LDtk instance id, for tearing down static anchors keyed by iid.
 * @calledby src/entities/Enemy.ts → the death path, the instant an enemy is killed
 * @calls    tearDownMovingAnchorKeys, tearDownPeriodicTimerKeys, tearDownEntitySoundSequence, tearDownStaticAnchorKeysByIid
 */
export function unregisterEntityAudio(
  sprite: PositionedGameObject,
  iid?: string,
): void {
  tearDownMovingAnchorKeys(sprite);
  tearDownPeriodicTimerKeys(sprite);
  tearDownEntitySoundSequence(sprite);
  if (iid !== undefined) {
    tearDownStaticAnchorKeysByIid(iid);
  }
}

/**
 * @function    registerEntityPeriodicSound
 * @description Schedules self-rescheduling one-shots for a creature (e.g. a crow caw) at a random delay in each binding's interval; each fire is distance-gated (silent past maxRadius, linear falloff within).
 * @param   entityIdentifier  LDtk type to look up periodic bindings for.
 * @param   sprite            The creature emitting the one-shots.
 * @calledby src/scenes/GameScene.ts → creature spawn, for entities with periodic-sound bindings
 * @calls    getEntityPeriodicSoundBindings/getSoundDefinition, Phaser's timer + sound managers, and the cached player position for gating
 */
export function registerEntityPeriodicSound(
  scene: Phaser.Scene,
  entityIdentifier: string,
  sprite: PositionedGameObject,
): void {
  const bindings = getEntityPeriodicSoundBindings(entityIdentifier);
  if (bindings.length === 0) return;
  const spriteId = getSpriteId(sprite);
  const timerKeys: string[] = [];
  for (const binding of bindings) {
    const def = getSoundDefinition(binding.soundId);
    if (def === null || def.spatial === undefined) continue;
    const timerKey = `${spriteId}:${binding.soundId}`;
    if (PERIODIC_TIMERS.has(timerKey)) continue;

    const schedule = (): void => {
      const delay =
        binding.minIntervalMs +
        Math.random() * (binding.maxIntervalMs - binding.minIntervalMs);
      const timer = scene.time.delayedCall(delay, () => {
        // sprite may have been destroyed between schedule and fire
        if (!sprite.active) return;
        const dx = sprite.x - lastPlayerX;
        const dy = sprite.y - lastPlayerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const { minRadius, maxRadius } = def.spatial!;
        if (dist < maxRadius) {
          let volume: number;
          if (dist <= minRadius) {
            volume = def.defaultVolume;
          } else {
            const t = (maxRadius - dist) / (maxRadius - minRadius);
            volume = def.defaultVolume * t;
          }
          const oneShot = scene.sound.add(binding.soundId, {
            loop: false,
            volume,
            rate: def.rate ?? 1,
          });
          oneShot.once(Phaser.Sound.Events.COMPLETE, () => oneShot.destroy());
          oneShot.play();
        }
        schedule();
      });
      PERIODIC_TIMERS.set(timerKey, timer);
    };
    schedule();
    timerKeys.push(timerKey);
  }
  if (timerKeys.length === 0) return;
  PERIODIC_TIMER_KEYS_BY_SPRITE.set(sprite, timerKeys);
  sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
    tearDownPeriodicTimerKeys(sprite);
  });
}

// hysteresis margin past maxRadius before culling; stops edge-of-range enemies from pausing/resuming every frame
const AUDIBLE_CULL_MARGIN_PX = 96;
/**
 * @function    updateEntitySounds
 * @description Per-frame spatial volume update for all entity anchors and sequence clips — caches the player position, pauses (not just mutes) disabled and out-of-range voices to save the audio thread, resumes ones back in earshot, and lerps volume across the linear falloff band. Cull uses a hysteresis margin so edge-of-range voices don't pause/resume every frame.
 * @param   playerX  The player's live world X — falloff origin and gate for off-frame periodic timers.
 * @param   playerY  The player's live world Y.
 * @calledby Phaser per-frame update loop (via src/scenes/GameScene.ts → update)
 * @calls    Phaser's per-sound pause/resume and setVolume on the concrete WebAudioSound subclass
 */
export function updateEntitySounds(playerX: number, playerY: number): void {
  lastPlayerX = playerX;
  lastPlayerY = playerY;
  for (const anchor of ENTITY_ANCHORS.values()) {
    const sound = anchor.sound;
    // idle enemy: pause (retains loop position) and skip distance math
    if (!anchor.enabled) {
      if (sound.isPlaying) sound.pause();
      continue;
    }
    const ax =
      anchor.source.kind === 'static'
        ? anchor.source.x
        : anchor.source.sprite.x;
    const ay =
      anchor.source.kind === 'static'
        ? anchor.source.y
        : anchor.source.sprite.y;
    const dx = ax - playerX;
    const dy = ay - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const { minRadius, maxRadius } = anchor.spatial;
    // resume in earshot, pause past the cull margin (hysteresis prevents per-frame thrash at the edge)
    if (dist < maxRadius) {
      if (sound.isPaused) sound.resume();
    } else if (dist >= maxRadius + AUDIBLE_CULL_MARGIN_PX) {
      if (sound.isPlaying) sound.pause();
    }
    if (sound.isPaused) continue;

    let volume: number;
    if (dist <= minRadius) {
      volume = anchor.defaultVolume;
    } else if (dist >= maxRadius) {
      volume = 0;
    } else {
      const t = (maxRadius - dist) / (maxRadius - minRadius);
      volume = anchor.defaultVolume * t;
    }
    // setVolume is on the concrete subclasses, not BaseSound; cast is safe for all three implementations
    (sound as Phaser.Sound.WebAudioSound).setVolume(volume);
  }

  // sequence playlists: same spatial math; skip paused clips (Phaser silences them at engine level)
  for (const state of SEQUENCE_STATES.values()) {
    const sound = state.currentSound;
    if (sound === null || state.isPaused) continue;
    const dx = state.sprite.x - playerX;
    const dy = state.sprite.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const { minRadius, maxRadius } = state.spatial;
    let volume: number;
    if (dist <= minRadius) {
      volume = state.defaultVolume;
    } else if (dist >= maxRadius) {
      volume = 0;
    } else {
      const t = (maxRadius - dist) / (maxRadius - minRadius);
      volume = state.defaultVolume * t;
    }
    (sound as Phaser.Sound.WebAudioSound).setVolume(volume);
  }
}

/**
 * @function    clearEntitySounds
 * @description Destroys all entity audio — anchors, periodic timers, and sequence clips — and clears every index. For HMR world rebuilds only; NOT called on scene.restart, where iid dedup keeps voices alive.
 * @calledby src/scenes/GameScene.ts → the HMR path that rebuilds the world from scratch
 * @calls    Phaser stop/destroy on each voice and TimerEvent.remove on each timer
 */
export function clearEntitySounds(): void {
  for (const anchor of ENTITY_ANCHORS.values()) {
    anchor.sound.stop();
    anchor.sound.destroy();
  }
  ENTITY_ANCHORS.clear();
  STATIC_ANCHOR_KEYS_BY_IID.clear();
  for (const timer of PERIODIC_TIMERS.values()) {
    timer.remove(false);
  }
  PERIODIC_TIMERS.clear();
  for (const state of SEQUENCE_STATES.values()) {
    if (state.currentSound) {
      state.currentSound.stop();
      state.currentSound.destroy();
      state.currentSound = null;
    }
  }
  SEQUENCE_STATES.clear();
}

// cached active state per slot; short-circuits same-value calls on the hot per-frame path
const PLAYER_SOUND_ACTIVE: Map<PlayerSoundSlot, boolean> = new Map();

/**
 * @function    setPlayerStateSoundActive
 * @description Toggles a player-state loop (footsteps, cloth, falling-whoosh) — lazy-creates the voice at volume 0 on first use, then fades to the default volume or silence; never destroys (the loop lives for the session). Short-circuits same-value calls on this hot path.
 * @param   slot    Which player-state loop.
 * @param   active  Whether the loop should be audible.
 * @param   fadeMs  Crossfade duration; defaults to the snappy PLAYER_STATE_CROSSFADE_MS.
 * @calledby src/entities/Player.ts and src/entities/playerMovementAudio.ts → as walk/slide/fall begin and end
 * @calls    getPlayerStateSoundId/getSoundDefinition, Phaser's sound manager, and fadeSoundDuration
 */
export function setPlayerStateSoundActive(
  scene: Phaser.Scene,
  slot: PlayerSoundSlot,
  active: boolean,
  fadeMs: number = PLAYER_STATE_CROSSFADE_MS,
): void {
  if (PLAYER_SOUND_ACTIVE.get(slot) === active) return;
  const id = getPlayerStateSoundId(slot);
  if (id === null) return;
  const def = getSoundDefinition(id);
  if (def === null) return;
  let sound = ACTIVE.get(id);
  if (sound === undefined) {
    sound = scene.sound.add(id, {
      loop: def.loop,
      volume: 0,
      rate: def.rate ?? 1,
    });
    sound.play();
    ACTIVE.set(id, sound);
  }
  const target = active ? def.defaultVolume : 0;
  fadeSoundDuration(scene, sound, target, fadeMs);
  PLAYER_SOUND_ACTIVE.set(slot, active);
}

// fallback spatial config for one-shots with no registry config; tuned for combat SFX (~4 tiles full, ~20 inaudible)
const DEFAULT_ONE_SHOT_SPATIAL: SpatialConfig = {
  minRadius: 64,
  maxRadius: 320,
};

/**
 * @function    playOneShot
 * @description Plays a sound once and frees it on completion. With an emitter it applies spatial falloff (silent past maxRadius, linear within) off the cached player position; without one it plays camera-fixed at default volume. Frees on COMPLETE or STOP plus a duration safety net, since interrupted one-shots may never fire COMPLETE.
 * @param   soundId  Registry id of the sound.
 * @param   seekSec  Start offset in seconds; default 0.
 * @param   emitter  Optional {x, y} world position for spatial falloff.
 * @returns the BaseSound, or null if the id is unknown or the emitter is out of earshot; frees the voice as a side effect.
 * @calledby widely used — combat/interaction code firing transient SFX: Player, Enemy, Trap, Chest, Door, GameScene, LandingScene, PauseScene
 * @calls    getSoundDefinition, the cached player position, Phaser's sound manager, and a delayed-call safety-net free
 */
export function playOneShot(
  scene: Phaser.Scene,
  soundId: string,
  seekSec: number = 0,
  emitter?: { readonly x: number; readonly y: number },
): Phaser.Sound.BaseSound | null {
  const def = getSoundDefinition(soundId);
  if (def === null) return null;
  let volume = def.defaultVolume;
  if (emitter !== undefined) {
    const spatial = def.spatial ?? DEFAULT_ONE_SHOT_SPATIAL;
    const dx = emitter.x - lastPlayerX;
    const dy = emitter.y - lastPlayerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= spatial.maxRadius) return null;
    if (dist > spatial.minRadius) {
      const t =
        (spatial.maxRadius - dist) /
        (spatial.maxRadius - spatial.minRadius);
      volume = def.defaultVolume * t;
    }
  }
  const sound = scene.sound.add(soundId, {
    loop: false,
    volume,
    rate: def.rate ?? 1,
  });
  // free on COMPLETE or STOP, plus a duration safety net — interrupted one-shots may never fire COMPLETE
  let freed = false;
  const free = (): void => {
    if (freed) return;
    freed = true;
    sound.destroy();
  };
  sound.once(Phaser.Sound.Events.COMPLETE, free);
  sound.once(Phaser.Sound.Events.STOP, free);
  if (seekSec > 0) {
    sound.play({ seek: seekSec });
  } else {
    sound.play();
  }
  const remainingMs = Math.ceil(((sound.duration ?? 0) - seekSec) * 1000);
  scene.time.delayedCall(Math.max(remainingMs, 0) + 250, free);
  return sound;
}

/**
 * @function    fadeSoundDuration
 * @description The fade primitive — kills any in-flight tween on the sound, then tweens its volume to target over durationMs.
 * @param   sound       The voice to fade.
 * @param   target      Target volume in [0, 1].
 * @param   durationMs  Fade duration in ms.
 * @param   onComplete  Optional callback fired when the tween finishes.
 * @calledby setPlayerStateSoundActive and fadeSound
 * @calls    the scene tween manager (killTweensOf/add)
 */
function fadeSoundDuration(
  scene: Phaser.Scene,
  sound: Phaser.Sound.BaseSound,
  target: number,
  durationMs: number,
  onComplete?: () => void,
): void {
  scene.tweens.killTweensOf(sound);
  scene.tweens.add({
    targets: sound,
    volume: target,
    duration: durationMs,
    onComplete,
  });
}

/**
 * @function    fadeSound
 * @description Ambience-fade wrapper at AMBIENCE_CROSSFADE_MS (1.5s) so level-transition call sites stay readable.
 * @param   sound       The voice to fade.
 * @param   target      Target volume in [0, 1].
 * @param   onComplete  Optional callback fired when the fade finishes.
 * @calledby setLevelAmbience
 * @calls    fadeSoundDuration
 */
function fadeSound(
  scene: Phaser.Scene,
  sound: Phaser.Sound.BaseSound,
  target: number,
  onComplete?: () => void,
): void {
  fadeSoundDuration(scene, sound, target, AMBIENCE_CROSSFADE_MS, onComplete);
}
