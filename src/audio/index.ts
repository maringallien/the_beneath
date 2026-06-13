/**
 * audio — public barrel for the game's audio subsystem.
 *
 * The single import surface for everything sound-related, so the rest of the
 * game imports from '../audio' rather than reaching into individual modules.
 * Groups the SoundManager runtime (preload, ambience, per-entity sound rigs,
 * master volume, one-shots, player-state crossfades), the sound-registry
 * lookups, the animation-frame trigger lookups, the persistent music-volume
 * preference, the MusicPlayer soundtrack control, and the shared sound/trigger
 * types.
 *
 * Inputs:  re-exports only — no logic of its own.
 * Outputs: the audio functions, constants, and types named below.
 * @calledby any module that plays, configures, or queries audio.
 * @calls    the underlying audio modules it re-exports.
 */
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
