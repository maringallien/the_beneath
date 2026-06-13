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
 * SoundManager — the game's whole audio runtime: spatial loops, one-shots, and
 * music/ambience crossfades.
 *
 * A module of free functions over module-level maps (no class). It owns level
 * ambience crossfades, player-state loops (footsteps/cloth/falling-whoosh),
 * per-entity spatial loops (static decoration + moving creatures + state-gated
 * enemy footsteps + playlists), periodic creature one-shots, and fire-and-forget
 * one-shots. Phaser's sound manager is game-scoped (one instance across all
 * scenes), so every BaseSound here outlives any one scene; the module-level
 * state is what keeps audio correct across scene.restart (respawn re-runs
 * GameScene.create() but our maps persist, so ambience never resets).
 *
 * Audio-thread budget is a first-class concern (this game has hit audio-thread
 * saturation): idle loops are PAUSED not just muted, sources past earshot are
 * distance-culled (paused with a hysteresis margin), and one-shots are freed on
 * COMPLETE/STOP plus a duration safety net — all to cap how many Web Audio voices
 * compete at once. Volume falloff everywhere is the same linear band: full inside
 * minRadius, zero past maxRadius, lerped between.
 *
 * Inputs:  the sound registry (definitions, per-entity bindings, ambience sets),
 *          a Phaser scene per call (for scene.sound / tweens / timers), and live
 *          player + sprite positions.
 * Outputs: created/destroyed BaseSound voices, volume tweens, and the cached
 *          player position used to gate off-frame timers.
 * @calledby the preload pipeline, the gameplay scene at level load / per frame /
 *           on level transition, the player's movement-and-combat code, and the
 *           enemy spawn/death lifecycle.
 * @calls    Phaser's game-scoped sound manager, the tween engine, the timer
 *           system, and the sound-registry loaders.
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

// queues every registry sound with Phaser's loader; skips duplicates so a second pass is harmless
export function preloadAll(scene: Phaser.Scene): void {
  for (const [id, def] of getAllSoundDefinitions()) {
    // Don't double-queue — Phaser's loader throws on duplicate keys.
    if (scene.cache.audio.exists(id)) {
      continue;
    }
    scene.load.audio(id, def.path);
  }
}

// crossfades to the new level's ambience set; globals mute-and-keep, non-globals stop-and-destroy; idempotent
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

// cold-start helper: fades up the default global ambience (same as setLevelAmbience(scene, null))
export function startGlobalAmbience(scene: Phaser.Scene): void {
  setLevelAmbience(scene, null);
}

// sets master volume clamped to [0,1]; Phaser multiplies it by each track's own volume
export function setMasterVolume(scene: Phaser.Scene, value: number): void {
  const clamped = Math.max(0, Math.min(1, value));
  scene.sound.volume = clamped;
}

// full audio shutdown — stops ambience, player-state loops, and entity sounds; intended for menu return
export function stopAll(scene: Phaser.Scene): void {
  for (const [id, sound] of ACTIVE.entries()) {
    scene.tweens.killTweensOf(sound);
    sound.stop();
    sound.destroy();
    ACTIVE.delete(id);
  }
  currentAmbienceIds = [];
  currentLevelId = null;
    // reset so the next activation recreates the (now-destroyed) BaseSound rather than fading a stale ref
  PLAYER_SOUND_ACTIVE.clear();
  clearEntitySounds();
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
// get-or-mint a stable surrogate id for a sprite
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
// applies ±MOVING_RATE_JITTER to decorrelate layered copies of the same sound
function jitteredRate(base: number): number {
  const jitter = 1 - MOVING_RATE_JITTER + Math.random() * MOVING_RATE_JITTER * 2;
  return base * jitter;
}

// registers fixed-position spatial loops for an immovable LDtk entity; idempotent, random seek so copies don't comb-filter
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

// like registerEntitySound but stores a live sprite ref — the per-frame update tracks the creature's position
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

// stops and destroys every moving/walk anchor a sprite owns
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

// registers walk-sound loops for an enemy: each starts muted+paused (costs nothing idle), resumes mid-cycle on chase
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

// flips walk anchor enabled flags; next per-frame update applies them (surface-gated anchors only enable when tile matches)
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

// starts an entity's sound-sequence playlist at index 0; idempotent (scene.restart safe)
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

// plays the current clip at volume 0 and wires COMPLETE to advance to the next (no-op while paused)
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

// pauses the current clip mid-position so resume picks up exactly where it left off
export function pauseEntitySoundSequence(sprite: PositionedGameObject): void {
  const state = SEQUENCE_STATES.get(sprite);
  if (!state || state.isPaused) return;
  state.isPaused = true;
  if (state.currentSound && state.currentSound.isPlaying) {
    state.currentSound.pause();
  }
}

// resumes a paused sequence; if the pause landed between clips, starts the next one
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

// stops/destroys the active clip and removes the playlist state for a sprite
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

// cancels every pending periodic timer for a sprite so no fire lands on a destroyed voice
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

// stops/destroys static anchors owned by a dying enemy (e.g. hive's bee buzz)
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

// cuts all audio for an entity at the killing blow — doesn't wait for the death animation to finish
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

// schedules self-rescheduling one-shots for a creature (e.g. crow caw) with a random delay; silent past maxRadius
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
// per-frame spatial volume update for all anchors and sequences; pauses (not just mutes) out-of-range voices to save audio thread
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

// TEMP DIAGNOSTIC: live collection sizes for the DEBUG_AUDIO logger (growing counts = leak; flat counts + dead audio = saturation)
export function debugAudioCounts(): {
  anchors: number;
  sequences: number;
  periodic: number;
} {
  return {
    anchors: ENTITY_ANCHORS.size,
    sequences: SEQUENCE_STATES.size,
    periodic: PERIODIC_TIMERS.size,
  };
}

// destroys all entity audio for HMR world rebuilds; NOT called on scene.restart (iid dedup handles that)
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

// toggles a player-state loop (footsteps, cloth, falling-whoosh); lazy-creates at volume 0, fades but never destroys
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

// plays a sound once and frees it on completion; pass an emitter for spatial falloff, omit for camera-fixed sounds
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

// the fade primitive: kills any in-flight tween on the sound first, then tweens volume to target over durationMs
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

// 1.5s ambience fade — thin wrapper so level-transition call sites stay readable
function fadeSound(
  scene: Phaser.Scene,
  sound: Phaser.Sound.BaseSound,
  target: number,
  onComplete?: () => void,
): void {
  fadeSoundDuration(scene, sound, target, AMBIENCE_CROSSFADE_MS, onComplete);
}
