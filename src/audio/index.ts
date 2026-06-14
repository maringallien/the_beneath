/**
 * @file audio/index.ts
 * @description Public barrel for the audio subsystem — single import surface re-exporting the SoundManager runtime, sound-registry and animation-trigger lookups, the music-volume preference, the MusicPlayer control, and the shared sound/trigger types. Re-exports only, no logic.
 * @module audio
 */
export {
  preloadAll,
  setLevelAmbience,
  setMasterVolume,
  registerEntitySound,
  registerMovingEntitySound,
  registerEntityPeriodicSound,
  registerEnemyWalkSound,
  setEnemyWalkSoundEnabled,
  registerEntitySoundSequence,
  pauseEntitySoundSequence,
  resumeEntitySoundSequence,
  unregisterEntityAudio,
  updateEntitySounds,
  clearEntitySounds,
  playOneShot,
  setPlayerStateSoundActive,
  AMBIENCE_CROSSFADE_MS,
  PLAYER_STATE_CROSSFADE_MS,
} from './SoundManager';
export {
  getAllSoundDefinitions,
  getSoundDefinition,
  getGlobalAmbienceIds,
  getAmbienceForLevel,
  getEntitySoundIds,
  getPlayerStateSoundId,
  getBoundEntityIdentifiers,
} from './soundRegistryLoader';
export {
  getTriggersFor,
  listAllTriggers,
} from './animationSoundTriggersLoader';
export {
  isMusicEnabled,
  getMusicVolume,
  setMusicVolume,
  toggleMusicMuted,
  onMusicVolumeChange,
  DEFAULT_MUSIC_VOLUME,
} from './musicSettings';
export { playMusic } from './MusicPlayer';
export type {
  SoundCategory,
  SoundDefinition,
  SpatialConfig,
  LevelAmbienceOverride,
  SoundRegistry,
  PlayerSoundSlot,
} from './soundRegistryTypes';
export type {
  AnimationTrigger,
  AnimationSoundTriggers,
} from './animationSoundTriggersTypes';
