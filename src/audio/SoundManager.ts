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

// Anything we treat as a "movable sound emitter" exposes a live world
// position. Phaser sprites already do; this structural type keeps the
// SoundManager decoupled from any specific sprite class.
export interface PositionedGameObject extends Phaser.GameObjects.GameObject {
  readonly x: number;
  readonly y: number;
}

// Crossfade duration when ambience changes on level transition. 1.5s is the
// sweet spot from playtesting — slow enough to feel intentional, fast enough
// that bouncing between adjacent levels still feels responsive. Exposed for
// override if a level needs a longer/shorter beat.
export const AMBIENCE_CROSSFADE_MS = 1500;

// Crossfade for player-state-driven loops (cloth movement, etc.). Much
// shorter than ambience because the player can start/stop walking many
// times per second — a long fade would smear into a near-constant tone.
// ~120ms is fast enough to feel responsive but slow enough to avoid the
// click an instant volume snap would produce.
export const PLAYER_STATE_CROSSFADE_MS = 120;

// Phaser's sound manager is game-scoped (one instance shared by all scenes),
// so BaseSound instances we create here outlive any individual scene's
// lifecycle. Module-level state lets us stay correct across scene restarts:
// respawn re-runs GameScene.create() but our ACTIVE map is preserved, so
// ambience continues uninterrupted.
const ACTIVE: Map<string, Phaser.Sound.BaseSound> = new Map();

// The set of ids currently fading toward (or sitting at) full volume. Used
// to short-circuit re-entry into the same level without doing per-frame
// tween work, and to diff against the next desired set on level change.
let currentAmbienceIds: ReadonlyArray<string> = [];

// Which level (LDtk identifier) we last applied ambience for. `null` means
// "no level set yet" — first call to setLevelAmbience always runs.
let currentLevelId: string | null = null;

// Cached set view of getGlobalAmbienceIds(). Globals are special: they're
// never destroyed on fade-out, only muted — so the audio file keeps playing
// silently and re-entry to a global-ambience level just fades them back up.
// This preserves the "ambience doesn't reset when crossing levels" promise
// for the default tracks while still allowing override levels to swap them
// out entirely.
const GLOBAL_AMBIENCE_SET: ReadonlySet<string> = new Set(getGlobalAmbienceIds());

// Registers every sound in the registry with Phaser's asset loader. Call
// from PreloadScene.preload() alongside the other preload pipelines so
// audio counts toward the loading bar progress.
export function preloadAll(scene: Phaser.Scene): void {
  for (const [id, def] of getAllSoundDefinitions()) {
    // Don't double-queue — Phaser's loader will throw on duplicate keys if
    // preload runs twice (won't happen today, but cheap insurance).
    if (scene.cache.audio.exists(id)) {
      continue;
    }
    scene.load.audio(id, def.path);
  }
}

// Applies the ambience set for the given level. Crossfades from the current
// set to the new one over AMBIENCE_CROSSFADE_MS:
//   - Tracks in both sets: untouched (they keep playing at full volume).
//   - Tracks leaving the set: fade to 0. Globals stay alive (so they can
//     resume on return without restarting); non-globals are stopped and
//     destroyed once the fade completes.
//   - Tracks entering the set: globals (still alive at volume 0) fade up;
//     non-globals are added fresh at volume 0 and faded up.
// Idempotent — re-applying the same levelId is a cheap no-op.
//
// Pass `null` for `levelId` to apply the default (globalAmbience) set —
// useful for cold-start before the player's level is known.
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
      // Non-global: once silenced, destroy so the next entry creates a
      // fresh instance (restart-from-beginning semantics for override
      // tracks). Guard the cleanup against late-arriving tween completion
      // after re-entry by re-checking that we still own this instance.
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

// Convenience for the cold-start path before any level is known. Equivalent
// to setLevelAmbience(scene, null) — fades the default globalAmbience set up
// from zero. Kept as a named export for readability at the call site.
export function startGlobalAmbience(scene: Phaser.Scene): void {
  setLevelAmbience(scene, null);
}

// Master volume in [0, 1]. Phaser multiplies this by each sound's per-track
// volume, so individual mix levels from the registry are preserved.
export function setMasterVolume(scene: Phaser.Scene, value: number): void {
  const clamped = Math.max(0, Math.min(1, value));
  scene.sound.volume = clamped;
}

// Stops every track this manager started and forgets them. Intended for
// future use (e.g. a main-menu return). Not called during normal gameplay.
export function stopAll(scene: Phaser.Scene): void {
  for (const [id, sound] of ACTIVE.entries()) {
    scene.tweens.killTweensOf(sound);
    sound.stop();
    sound.destroy();
    ACTIVE.delete(id);
  }
  currentAmbienceIds = [];
  currentLevelId = null;
  // Without this reset, a subsequent setPlayerStateSoundActive(_, true) would
  // see the cached `true` and skip recreation, fading a destroyed BaseSound.
  PLAYER_SOUND_ACTIVE.clear();
  clearEntitySounds();
}

// One per (LDtk entity instance, bound sound) pair. Keyed by `iid:soundId`
// so an entity bound to multiple sounds gets one anchor per sound. The iid
// component is the stable LDtk per-instance identifier (survives reparse),
// so respawn — which re-runs buildWorld but re-parses to the same set of
// iids — can short-circuit on already-registered anchors instead of
// stopping and restarting the loops.
//
// Static anchors hold fixed coords (immovable LDtk decoration: house fan,
// hive, light fixture). Moving anchors hold a sprite reference — their
// position is read live each frame, and the anchor is auto-cleaned up
// when the sprite is destroyed. The two forms share the volume-update
// path so the spatial falloff math stays in one place.
interface EntitySoundAnchor {
  readonly sound: Phaser.Sound.BaseSound;
  readonly spatial: SpatialConfig;
  readonly defaultVolume: number;
  // Mutable gate: when false, the anchor is silenced regardless of distance.
  // Used by walk-sound anchors (registered muted, fade in only while the
  // owning enemy is in chase/loiter state). All other anchor kinds set this
  // to true at creation and never flip it.
  enabled: boolean;
  // Optional surface tag for walk-sound anchors. `'always'` plays whenever
  // the owning enemy is in a walking state; `'ground'` / `'bridge'` are
  // gated on the IntGrid tile under the enemy's feet via the `surface`
  // argument to setEnemyWalkSoundEnabled. Undefined for non-walk anchors.
  readonly surface?: WalkSoundSurface;
  readonly source:
    | { readonly kind: 'static'; readonly x: number; readonly y: number }
    | { readonly kind: 'moving'; readonly sprite: PositionedGameObject };
}
const ENTITY_ANCHORS: Map<string, EntitySoundAnchor> = new Map();

// Latest player position, cached in updateEntitySounds(). Periodic-sound
// timers fire outside the per-frame call site so they need this to gate
// emission on distance.
let lastPlayerX = 0;
let lastPlayerY = 0;

// Per-(sprite, soundId) Phaser TimerEvents for the periodic-call schedulers.
// Tracked so a destroyed sprite (death, level rebuild) cleanly cancels its
// pending fires instead of trying to play from a destroyed BaseSound.
const PERIODIC_TIMERS: Map<string, Phaser.Time.TimerEvent> = new Map();
// Surrogate id used to key periodic timers and moving anchors against a
// sprite reference. WeakMap so destroyed sprites don't leak.
let periodicIdCounter = 0;
const SPRITE_IDS: WeakMap<PositionedGameObject, string> = new WeakMap();
function getSpriteId(sprite: PositionedGameObject): string {
  let id = SPRITE_IDS.get(sprite);
  if (id === undefined) {
    id = `sprite#${++periodicIdCounter}`;
    SPRITE_IDS.set(sprite, id);
  }
  return id;
}

// Per-sprite reverse index of the anchor / timer keys they own. Lets
// unregisterEntityAudio tear them down at the moment of death without
// waiting for the sprite to actually destroy (death animations can run for
// hundreds of ms, and the user expects audio to cut on the killing blow).
const MOVING_ANCHOR_KEYS_BY_SPRITE: WeakMap<
  PositionedGameObject,
  string[]
> = new WeakMap();
const PERIODIC_TIMER_KEYS_BY_SPRITE: WeakMap<
  PositionedGameObject,
  string[]
> = new WeakMap();
// Reverse index for static anchors so unregisterEntityAudio can tear them
// down on Enemy death (e.g. the hive's bee buzz, which is technically a
// static-position binding but conceptually owned by the hive Enemy). Without
// this, the loop would keep playing until HMR / scene shutdown.
const STATIC_ANCHOR_KEYS_BY_IID: Map<string, string[]> = new Map();

// Per-instance pitch jitter for moving entity sounds. When several crows or
// wasps are within audible range, identical waveforms layered with identical
// pitch comb-filter together (the "hollow whoosh" the user heard). A small
// random rate offset decorrelates them so they sound like distinct creatures
// instead of one phased mass.
const MOVING_RATE_JITTER = 0.08;
function jitteredRate(base: number): number {
  const jitter = 1 - MOVING_RATE_JITTER + Math.random() * MOVING_RATE_JITTER * 2;
  return base * jitter;
}

// Registers spatial sounds at a fixed world position for one LDtk entity
// instance. Every sound id bound to the entity's identifier in
// `entitySounds` gets its own anchored loop, so a single light fixture can
// layer e.g. a bulb buzz with an insect wings track. If no binding exists
// or every (iid, soundId) pair is already registered, returns silently —
// so callers can iterate every entity instance without pre-filtering and
// the function survives scene.restart (respawn) without doubling up.
//
// The first registration of an anchor starts the sound at a random seek
// offset so multiple identical sources (e.g. six House2 fans) don't
// comb-filter against each other.
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
    // Phaser populates `duration` after the audio buffer is decoded.
    // Preload happens in PreloadScene so by buildWorld time the value
    // should be set; fall back to 0 (start-of-track) if it's not yet known.
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

// Same idea as registerEntitySound, but for entities that move during play
// (wasps, evil crows, spark bugs). The anchor stores a live sprite ref
// instead of fixed coords — updateEntitySounds reads the sprite's current
// position each frame so the loop's volume tracks the creature in flight.
// On sprite destroy, the anchor is torn down automatically.
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
  // Phaser fires DESTROY on scene.shutdown for every GameObject, so a
  // scene.restart (respawn) automatically tears these anchors down and the
  // next buildWorld registers fresh ones for the re-spawned enemies.
  // unregisterEntityAudio (called from Enemy.enterDeadState) usually beats
  // this listener, so the DESTROY handler is the fallback for paths that
  // skip the death state (HMR teardown, scene shutdown).
  sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
    tearDownMovingAnchorKeys(sprite);
  });
}

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

// Per-sprite reverse index for walk-sound anchors. Walk anchors are also
// registered in MOVING_ANCHOR_KEYS_BY_SPRITE (so destroy/unregister tear them
// down with the rest), but setEnemyWalkSoundEnabled needs an O(1) lookup
// from sprite → anchor keys without scanning every moving anchor the sprite
// owns. A single entity may bind multiple walk loops (e.g. a boss with
// footstep + ground-impact layers) so the value is an array.
const WALK_ANCHOR_KEYS_BY_SPRITE: WeakMap<PositionedGameObject, string[]> =
  new WeakMap();

// Same shape as registerMovingEntitySound, but each anchor is created muted
// (enabled: false) and gated by enemy state via setEnemyWalkSoundEnabled.
// Each looping BaseSound plays at volume 0 from creation so a state-driven
// fade-in resumes mid-cycle rather than restarting from frame 0 — keeping
// the footstep cadence continuous when the enemy oscillates between
// chase/idle (typical for stutter-step combat AI). Layered walk sounds toggle
// together.
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
    // Loader guarantees spatial + loop=true, so these conditions are guard
    // rails for a manual-edit registry rather than expected runtime paths.
    if (def === null || def.spatial === undefined || !def.loop) continue;

    const sound = scene.sound.add(binding.soundId, {
      loop: true,
      volume: 0,
      rate: jitteredRate(def.rate ?? 1),
    });
    const duration = sound.duration ?? 0;
    const seek = duration > 0 ? Math.random() * duration : 0;
    sound.play({ seek });
    // Created disabled (enabled:false below): pause immediately so an idle
    // enemy's footstep loop costs nothing on the audio thread until it actually
    // moves and is in earshot (updateEntitySounds resumes it). The position is
    // retained, so the random seek above still gives each loop its own phase.
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
  // Reuse the moving-anchor reverse index so existing destroy / unregister
  // paths tear the walk sounds down alongside any wing-flap loops the sprite
  // also owns. No new lifecycle code needed.
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

// Flips the enabled flag on every walk anchor bound to this sprite. The next
// per-frame updateEntitySounds pass picks up the change: enabled true →
// spatial volume scales normally; enabled false → silenced (volume 0, loops
// continue at position so the cadence resumes naturally when re-enabled).
// No-op for sprites without registered walk sounds.
//
// `surface` selects which surface-tagged anchors fade in when enabling. The
// `'always'`-tagged anchors play whenever `enabled` is true regardless of
// surface (ghoul's mud footsteps). `'ground'` / `'bridge'` anchors fade in
// only when the argument matches; the other surface stays muted (continues
// to loop at position 0 so the cadence resumes cleanly when the surface
// flips back). Pass null when neither surface applies (mid-air, off-grid)
// to silence all surface-gated anchors while keeping `'always'` ones audible.
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
  // Note: only the `enabled` flag is set here. The actual pause/resume (and the
  // distance cull) is owned by updateEntitySounds — driving playback from one
  // place keeps this per-frame chase call from fighting the distance gate, which
  // would otherwise thrash pause/resume every frame for a far, moving enemy.
}

// Per-sprite playlist state for `entitySoundSequences`. The sequencer plays
// the entity's sound ids in order, advances to the next on natural COMPLETE,
// wraps at the end, and pauses/resumes the underlying BaseSound so an
// interruption (e.g. the widow's teleport) picks up mid-clip instead of
// restarting. Volume is recomputed each frame from sprite distance in
// updateEntitySounds, sharing the linear-falloff math with anchor sounds.
//
// Lifecycle: registered at entity spawn (GameScene), torn down at entity
// death (unregisterEntityAudio) or sprite destroy (DESTROY listener), or
// scene rebuild (clearEntitySounds / stopAll).
interface EntitySoundSequenceState {
  readonly scene: Phaser.Scene;
  readonly sprite: PositionedGameObject;
  readonly soundIds: ReadonlyArray<string>;
  readonly defaultVolume: number;
  readonly spatial: SpatialConfig;
  // Index of the clip currently playing (or about to play after resume).
  // Wraps mod soundIds.length on COMPLETE.
  currentIndex: number;
  // BaseSound for the active clip. Null only between COMPLETE-while-paused
  // and resume — in that gap, resumeEntitySoundSequence starts the next clip.
  currentSound: Phaser.Sound.BaseSound | null;
  isPaused: boolean;
}

const SEQUENCE_STATES: Map<PositionedGameObject, EntitySoundSequenceState> =
  new Map();

// Starts the entity's sequence at index 0. Idempotent — re-registration of
// the same sprite (e.g. scene.restart respawn race) is a no-op. Reads the
// playlist binding from the registry; entities without a binding are skipped
// silently so callers can iterate every spawn without pre-filtering.
//
// All clips in the playlist share the spatial config + defaultVolume of the
// first clip; mixing per-clip values mid-sequence would surprise the player
// when the volume jumps at an advance. The loader rejects sequences where
// clips diverge on spatial presence (all must have it), so the only
// remaining drift is per-clip defaultVolume — we sample the first and keep
// it constant across the playlist.
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

// Creates the BaseSound for state.currentIndex and wires its COMPLETE
// handler to advance the index and recurse. Volume starts at 0 — the
// next updateEntitySounds tick computes the spatial value. Paused
// sequences never reach here; advance-while-paused goes through
// resumeEntitySoundSequence.
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
    // Late COMPLETE arriving after teardown — drop on the floor. We can't
    // check `state.currentSound === sound` directly because the teardown
    // path nulls it; checking the map membership is the same idea but
    // robust to that ordering.
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

// Pauses the currently-playing clip via BaseSound.pause — preserves the
// playback position so resume picks up mid-clip. No-op if already paused
// or if no sequence is registered for this sprite.
export function pauseEntitySoundSequence(sprite: PositionedGameObject): void {
  const state = SEQUENCE_STATES.get(sprite);
  if (!state || state.isPaused) return;
  state.isPaused = true;
  if (state.currentSound && state.currentSound.isPlaying) {
    state.currentSound.pause();
  }
}

// Resumes the paused clip (or, if pause happened during the gap between a
// COMPLETE and the next play, starts the next clip from its beginning).
// No-op if not paused or if no sequence is registered.
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

// Tears down every spatial loop and periodic timer this entity owns,
// independently of the sprite's destroy lifecycle. Called from
// Enemy.enterDeadState so the wing-flap loop, crow caw scheduler, and the
// hive's bee-buzz all cut at the killing blow rather than at the end of the
// death animation. `iid` is optional — pass it for entities that are bound
// through static `entitySounds` (immovable enemies like the hive); moving
// enemies pass only the sprite. Idempotent and a no-op for entities with no
// registered audio.
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

// Schedules periodic one-shot plays for a moving creature (e.g. crow caw).
// Each binding gets its own per-sprite repeating timer with a uniformly
// random delay between fires. Each fire is gated on the sprite being within
// the sound's spatial.maxRadius of the cached player position; emitters
// past the audible range stay silent until they get closer (timer keeps
// running so the cadence remains "natural" — the player just doesn't hear
// every call). Volume falls off linearly inside the audible band, matching
// the looping-spatial path.
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
        // Sprite may have been destroyed between schedule and fire — the
        // DESTROY cleanup below should have removed the timer, but guard
        // anyway in case Phaser fires the delayedCall in the same tick.
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

// Per-frame volume update for every registered entity sound. Linear falloff:
// volume = defaultVolume inside minRadius, 0 outside maxRadius, linearly
// interpolated in between. Cheap enough at expected counts (~tens) that we
// don't bother with squared-distance shortcuts or spatial partitioning.
// Also caches the player position so the periodic-call scheduler can gate
// distant emitters on the same coordinates without an extra plumbing path.
//
// Past maxRadius + AUDIBLE_CULL_MARGIN_PX an active loop is paused (not just
// muted) so it stops costing audio-thread time when many emitters are live; the
// margin is hysteresis so an enemy hovering at the edge doesn't pause/resume
// every frame (the band past maxRadius is silent regardless).
const AUDIBLE_CULL_MARGIN_PX = 96;
export function updateEntitySounds(playerX: number, playerY: number): void {
  lastPlayerX = playerX;
  lastPlayerY = playerY;
  for (const anchor of ENTITY_ANCHORS.values()) {
    const sound = anchor.sound;
    // A disabled loop (idle enemy) is always silent — pause it so it stops
    // costing audio-thread time, and skip the distance math entirely. Pause
    // retains the loop position, so the cadence resumes mid-cycle when the
    // enemy moves again rather than snapping back to frame 0.
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
    // Distance cull: render only within earshot. A source past maxRadius is
    // inaudible anyway, so pausing it (with the hysteresis margin) caps how many
    // loops actually compete on the audio thread when a crowd of enemies is up.
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
    // Phaser declares setVolume on the concrete sound subclasses (WebAudio
    // /HTML5Audio/NoAudio) but not on BaseSound. All three implement it, so
    // a single cast through WebAudioSound is safe regardless of which the
    // runtime SoundManager produced.
    (sound as Phaser.Sound.WebAudioSound).setVolume(volume);
  }

  // Sequence playlists track sprite position too. Paused clips keep their
  // current volume (Phaser silences a paused sound at the engine level, so a
  // setVolume call here would be wasted) and skipped to avoid clobbering it.
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

// TEMP DIAGNOSTIC — remove together with the GameScene DEBUG_AUDIO logger. Live
// sizes of the long-lived audio collections, so a 1 Hz log can distinguish a
// leak (a count climbing without bound) from audio-thread saturation (flat
// counts, audio still dying) at runtime.
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

// Destroys every registered entity sound. Called from tearDownWorld before
// the LDtk world is rebuilt on HMR, where entity iids may have shifted
// and stale anchors would refer to entities that no longer exist. Not
// called on scene.restart (respawn) — registerEntitySound's iid-keyed
// dedup handles that path without resetting the bound loops.
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

// Per-slot last-known active state. The hot path runs every frame from
// Player.update, so a cached boolean per slot lets repeated calls with the
// same value short-circuit without re-arming a tween. Reset (cleared) in
// stopAll so a subsequent activation re-creates the (now-destroyed)
// BaseSound rather than fading a stale reference.
const PLAYER_SOUND_ACTIVE: Map<PlayerSoundSlot, boolean> = new Map();

// Toggles a registry-declared `playerStateSounds.<slot>` loop. The BaseSound
// is lazy-created on first activation (mirrors how setLevelAmbience treats
// incoming non-global ambience: scene.sound.add at volume 0, .play(), then
// fade up). On deactivation it fades down to 0 but is NOT destroyed — the
// player toggles these many times per session and recreating each time would
// be wasteful and would also restart the loop from frame 0, audible on the
// short PLAYER_STATE_CROSSFADE_MS fade.
//
// Per the SoundManager comment at the top of this file, the BaseSound lives
// in Phaser's game-scoped sound manager and survives scene.restart, so a
// respawn into an idle state correctly leaves the sound silent and the
// first post-respawn frame that wants it fades it back up without
// reinitializing.
//
// `fadeMs` overrides the crossfade duration for this transition. Defaults to
// PLAYER_STATE_CROSSFADE_MS (snappy, for footsteps/movement/wall-slide). The
// falling-whoosh slot passes a longer value on activation (a swell) and a
// short one on deactivation (a quick cut when landing) — see Player's
// updateFallingSound.
//
// No-op if the registry omits the slot.
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

// Fallback spatial falloff applied when an emitter is supplied but the
// sound has no spatial config in the registry. Tuned for enemy combat
// events (hurt grunts, swing whooshes): full volume within ~4 tiles,
// inaudible past ~20 tiles. Per-sound spatial overrides this when the
// registry author wants finer tuning.
const DEFAULT_ONE_SHOT_SPATIAL: SpatialConfig = {
  minRadius: 64,
  maxRadius: 320,
};

// Plays a registered sound once and forgets it. Intended for discrete
// gameplay events rather than spatial loops. The sound is destroyed on
// completion so repeated triggers don't leak. Returns null if the id isn't
// in the registry (keeping call sites tolerant of mistyped ids during
// development) or if `emitter` is supplied and the player is past the
// spatial maxRadius (silenced entirely rather than playing at volume 0,
// so distant emitters don't pile up unused Audio nodes).
//
// `seekSec` (optional, default 0) starts playback that many seconds into
// the buffer — used by animation triggers that need to fire the middle of
// a sound rather than the beginning. Values past the buffer length are
// clamped by Phaser's WebAudio backend.
//
// `emitter` (optional) makes the sound spatial: volume scales linearly
// from defaultVolume inside the sound's minRadius to 0 at maxRadius, using
// distance from the last cached player position. Omit for camera-fixed
// events (player actions, UI stings) so they stay at full volume.
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
  // Reclaim the WebAudio node when the clip ends. COMPLETE is the normal path,
  // but a one-shot that's interrupted — stopped, or re-triggered faster than its
  // own length (e.g. animation-frame SFX during fast enemy state churn) — may
  // never fire COMPLETE, leaking live nodes that progressively saturate the
  // audio thread. So also free on STOP, plus a duration-based safety net.
  // `freed` guards against a double destroy when more than one path fires.
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

// Tweens a sound's volume toward `target` over the supplied duration. Any
// in-flight tween on the same sound is killed first so a rapid reversal can
// happen without two tweens fighting. The optional onComplete fires only
// when the tween reaches `target` cleanly (Phaser invokes onComplete on
// natural completion; killed tweens skip it).
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

// Ambience-speed fade (1.5s). Thin wrapper kept so the level-transition call
// sites stay readable.
function fadeSound(
  scene: Phaser.Scene,
  sound: Phaser.Sound.BaseSound,
  target: number,
  onComplete?: () => void,
): void {
  fadeSoundDuration(scene, sound, target, AMBIENCE_CROSSFADE_MS, onComplete);
}
