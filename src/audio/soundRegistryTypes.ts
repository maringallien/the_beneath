// Schema for the JSON-authored sound registry. Each sound id (e.g.
// "cave_drips_flowing") maps to one SoundDefinition describing where the file
// lives and how it should be played by default. The registry is the single
// source of truth for audio assets — adding a new sound is one JSON entry,
// not a hand-rolled load call in PreloadScene.

export type SoundCategory = 'ambience' | 'sfx' | 'music';

// Spatial audio parameters for sounds attached to world positions (e.g.
// entity-anchored fans/HVAC). Volume falls off linearly from defaultVolume
// at minRadius to zero at maxRadius. Required for sounds bound to entities
// in `entitySounds`; ignored for level ambience.
export interface SpatialConfig {
  readonly minRadius: number;
  readonly maxRadius: number;
}

export interface SoundDefinition {
  // Path to the audio file, relative to /public (Vite serves /public at the
  // site root). e.g. "assets/audio/ambience/cave_drips_flowing.ogg".
  readonly path: string;
  readonly category: SoundCategory;
  // Whether playback should loop. Ambience and music typically loop; sfx
  // typically don't.
  readonly loop: boolean;
  // Volume in [0, 1]. SoundManager multiplies this by the master volume
  // when starting playback.
  readonly defaultVolume: number;
  // Optional playback rate multiplier. 1.0 = normal speed/pitch (default).
  // Phaser couples speed and pitch — 1.3 plays 30% faster AND 30% higher
  // pitched. Used when an audio asset's natural tempo doesn't match the
  // animation cadence it's anchored to (e.g. footsteps on metal stairs
  // recorded at a slower walking pace than the player's run speed).
  readonly rate?: number;
  // Optional spatial config. Present only on sounds intended to be attached
  // to a world position (entity sounds). Absent on level-ambience sounds,
  // which are played non-positionally at defaultVolume.
  readonly spatial?: SpatialConfig;
}

// Per-level customization of which sounds play. When a level identifier
// (e.g. LDtk "Level_3") is present in `levelOverrides`, the ambience list
// for that level replaces `globalAmbience` while the player is inside it.
export interface LevelAmbienceOverride {
  readonly ambience: ReadonlyArray<string>;
}

// Named slots for sounds driven by the player's state machine rather than by
// level transition or entity proximity. Each slot references a sound id from
// `sounds`. SoundManager exposes one toggle per slot via
// setPlayerStateSoundActive(slot, active).
//   - movement: cloth/wool loop that plays while the player's body anim is
//     anything other than idle or death.
//   - footstepsGround: footstep loop that plays while the player is running
//     on "ground" (IntGrid value 1) tiles.
//   - footstepsBridge: footstep loop that plays while the player is running
//     on "bridge" (IntGrid value 2) tiles. Mutually exclusive with the
//     footstepsGround slot — only one footstep surface is active at a time.
//   - wallSlide: scraping loop that plays while the player is wall-sliding
//     (pressing into a wall while falling). Crossfades in/out on contact via
//     the same PLAYER_STATE_CROSSFADE_MS path the other slots use.
export interface PlayerStateSounds {
  readonly movement?: string;
  readonly footstepsGround?: string;
  readonly footstepsBridge?: string;
  readonly wallSlide?: string;
}

// Union of slot keys in PlayerStateSounds. Listed explicitly (rather than
// derived via `keyof PlayerStateSounds`) so a new slot can't be referenced
// in code before its key is added here AND its sound id is wired up.
export type PlayerSoundSlot =
  | 'movement'
  | 'footstepsGround'
  | 'footstepsBridge'
  | 'wallSlide';

// Periodic one-shot binding for a moving creature (e.g. crow caw). The
// SoundManager scheduler picks a uniformly-random delay in [minIntervalMs,
// maxIntervalMs] between firings. Each firing is gated on the bound sprite
// being within the sound's spatial.maxRadius of the player (falloff math
// matches the looping spatial path), so distant crows stay silent.
export interface PeriodicEntitySoundBinding {
  readonly soundId: string;
  readonly minIntervalMs: number;
  readonly maxIntervalMs: number;
}

// Surface tag for a walk sound. `'always'` plays whenever the enemy is in a
// walking state (e.g. ghoul's mud footsteps). `'ground'` / `'bridge'` are
// gated on the IntGrid tile under the enemy's feet — only the binding
// matching the current surface fades in, the other surface bindings stay
// muted. See setEnemyWalkSoundEnabled in SoundManager.
export type WalkSoundSurface = 'always' | 'ground' | 'bridge';

export interface EntityWalkSoundBinding {
  readonly soundId: string;
  readonly surface: WalkSoundSurface;
}

export interface SoundRegistry {
  readonly sounds: Readonly<Record<string, SoundDefinition>>;
  // Sound ids that play scene-wide when the game starts. Persist across
  // level transitions and scene restarts (SoundManager keeps the BaseSound
  // instances alive and modulates volume on level change).
  readonly globalAmbience: ReadonlyArray<string>;
  // Per-level ambience overrides. When the player enters a level present
  // here, SoundManager crossfades from globalAmbience to this set.
  readonly levelOverrides: Readonly<Record<string, LevelAmbienceOverride>>;
  // Bindings from LDtk entity identifier (e.g. "House2") to one or more
  // spatial sound ids. Every instance of the bound entity in the LDtk world
  // gets a looping audio source per bound id, anchored at its world position
  // with volume falling off per the sound's `spatial` block. Each referenced
  // sound MUST have a spatial config — the loader enforces this.
  readonly entitySounds: Readonly<Record<string, ReadonlyArray<string>>>;
  // Bindings for moving entities (wasps, crows, etc). Same shape as
  // entitySounds, but the SoundManager anchors these to the live sprite's
  // position each frame instead of a static LDtk pivot, so the loop tracks
  // the creature as it flies/walks around. Each referenced sound MUST have
  // a spatial config — loader enforces.
  readonly movingEntitySounds: Readonly<Record<string, ReadonlyArray<string>>>;
  // State-gated spatial loops tied to walking/chasing. Unlike movingEntitySounds
  // (which plays continuously while alive), entityWalkSounds are registered
  // muted and only audible while the enemy is in a walking state — Enemy.ts
  // toggles them via setEnemyWalkSoundEnabled on state transitions. The JSON
  // accepts: a single string, an array of strings, or an object with
  // `ground`/`bridge` keys for surface-gated footsteps (only the binding
  // matching the tile underfoot fades in during chase). Each referenced sound
  // MUST be spatial + looping. Bindings without a surface tag (`'always'`)
  // play whenever the enemy is in a walking state.
  readonly entityWalkSounds: Readonly<
    Record<string, ReadonlyArray<EntityWalkSoundBinding>>
  >;
  // Per-entity ordered playlists that loop indefinitely. SoundManager plays
  // the ids in order, advances on each sound's natural COMPLETE, wraps back
  // to index 0 at the end, and tracks position via BaseSound.pause/resume so
  // an interruption (e.g. the widow's teleport) resumes mid-clip rather than
  // restarting it. Each referenced sound MUST have spatial config and
  // loop=false — the playlist provides the looping behavior, individual
  // clips play once per turn.
  readonly entitySoundSequences: Readonly<Record<string, ReadonlyArray<string>>>;
  // Periodic one-shots per moving entity. Independent of movingEntitySounds —
  // a crow can both buzz (continuous loop via movingEntitySounds) AND caw
  // (occasional one-shot via this list).
  readonly entityPeriodicSounds: Readonly<
    Record<string, ReadonlyArray<PeriodicEntitySoundBinding>>
  >;
  // Sounds toggled by the player's state machine. Optional — a registry that
  // omits the key resolves every slot to undefined (SoundManager treats this
  // as "no movement sound configured" and the toggle becomes a no-op).
  readonly playerStateSounds: PlayerStateSounds;
}
