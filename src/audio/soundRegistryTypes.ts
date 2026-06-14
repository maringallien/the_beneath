/**
 * @file audio/soundRegistryTypes.ts
 * @description Schema types for the JSON-authored sound registry — each id maps to one SoundDefinition (file + default playback), plus the level-ambience, entity-binding, and player-state groupings SoundManager reads. Single source of truth for audio assets (adding a sound is one JSON entry). Leaf type module consumed by the registry loader, SoundManager, and MusicPlayer.
 * @module audio
 */

// the three top-level audio buckets
export type SoundCategory = 'ambience' | 'sfx' | 'music';

// linear volume falloff from defaultVolume at minRadius to 0 at maxRadius; required for entity-anchored sounds
export interface SpatialConfig {
  readonly minRadius: number;
  readonly maxRadius: number;
}

export interface SoundDefinition {
  // relative to /public (Vite root). e.g. "assets/audio/ambience/cave_drips_flowing.ogg"
  readonly path: string;
  readonly category: SoundCategory;
  readonly loop: boolean;
  // SoundManager multiplies this by master volume; keep it in [0, 1]
  readonly defaultVolume: number;
  // playback rate; Phaser couples speed+pitch so 1.3 = 30% faster and 30% higher
  readonly rate?: number;
  // present only on entity-anchored sounds; absent = non-positional (played at defaultVolume)
  readonly spatial?: SpatialConfig;
}

// ambience list that replaces globalAmbience while the player is inside a specific level
export interface LevelAmbienceOverride {
  readonly ambience: ReadonlyArray<string>;
}

// state-machine-driven loops toggled via setPlayerStateSoundActive; movement=cloth, footsteps*=surface steps, wallSlide=scrape, falling=wind-whoosh
export interface PlayerStateSounds {
  readonly movement?: string;
  readonly footstepsGround?: string;
  readonly footstepsBridge?: string;
  readonly wallSlide?: string;
  readonly falling?: string;
}

// listed explicitly so a new slot can't be referenced in code before its key is added here AND wired up
export type PlayerSoundSlot =
  | 'movement'
  | 'footstepsGround'
  | 'footstepsBridge'
  | 'wallSlide'
  | 'falling';

// scheduler picks a random delay in [minIntervalMs, maxIntervalMs]; fires are gated on player distance
export interface PeriodicEntitySoundBinding {
  readonly soundId: string;
  readonly minIntervalMs: number;
  readonly maxIntervalMs: number;
}

// 'always' = plays whenever walking; 'ground'/'bridge' = gated on the IntGrid tile underfoot
export type WalkSoundSurface = 'always' | 'ground' | 'bridge';

export interface EntityWalkSoundBinding {
  readonly soundId: string;
  readonly surface: WalkSoundSurface;
}

export interface SoundRegistry {
  readonly sounds: Readonly<Record<string, SoundDefinition>>;
  // play scene-wide from start; persist across level transitions (SoundManager keeps the voices alive)
  readonly globalAmbience: ReadonlyArray<string>;
  // per-level overrides; SoundManager crossfades from globalAmbience to this set on entry
  readonly levelOverrides: Readonly<Record<string, LevelAmbienceOverride>>;
  // static entity loops anchored at LDtk world position; all ids must have spatial config
  readonly entitySounds: Readonly<Record<string, ReadonlyArray<string>>>;
  // same as entitySounds but anchored to the live sprite position each frame (wasps, crows, etc.)
  readonly movingEntitySounds: Readonly<Record<string, ReadonlyArray<string>>>;
  // registered muted, only audible while the enemy walks; JSON accepts string/array/surface-object forms
  readonly entityWalkSounds: Readonly<
    Record<string, ReadonlyArray<EntityWalkSoundBinding>>
  >;
  // ordered playlists that loop by advancing on COMPLETE; ids must be spatial+non-looping
  readonly entitySoundSequences: Readonly<Record<string, ReadonlyArray<string>>>;
  // intermittent one-shots per entity; independent of movingEntitySounds (a crow can buzz AND caw)
  readonly entityPeriodicSounds: Readonly<
    Record<string, ReadonlyArray<PeriodicEntitySoundBinding>>
  >;
  // optional; omitted key = every slot resolves null = toggle is a no-op
  readonly playerStateSounds: PlayerStateSounds;
}
