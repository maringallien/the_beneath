export {
  preloadAll,
  startGlobalAmbience,
  setLevelAmbience,
  setMasterVolume,
  stopAll,
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
  debugAudioCounts,
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
