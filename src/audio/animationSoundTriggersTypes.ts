// Runtime-side shapes for src/audio/animationSoundTriggers.json. Authored by
// the tools/anim-sound-aligner browser tool and read by Player.ts (and any
// future entity that needs animation-frame-driven audio).

export interface AnimationTrigger {
  // Stable name for the trigger within an animation. Used as the per-anim
  // dedup key so the trigger fires at most once per anim playthrough even
  // though ANIMATION_UPDATE fires every frame.
  readonly name: string;
  readonly soundId: string;
  // 1-based, matching Phaser AnimationFrame.index. The trigger fires when
  // frame.index >= frameIndex (first frame at-or-past the threshold wins).
  readonly frameIndex: number;
  // Skip this many milliseconds into the audio buffer when firing. Lets a
  // trigger play the *middle* of a sound (e.g., cut off a long wind-up).
  // Omitted / 0 = play from the start. Must be >= 0 if present.
  readonly audioStartOffsetMs?: number;
  // When true, the spawned sound is stopped on ANIMATION_COMPLETE (or
  // ANIMATION_START of the next anim) so audio longer than the anim
  // doesn't overhang. Default false: sound plays to its natural end.
  readonly stopOnAnimComplete?: boolean;
  // When true, this trigger's fired-flag is reset on ANIMATION_REPEAT so it
  // re-fires on every loop iteration (use for per-step / per-beat effects
  // like footsteps). Default false: trigger fires once per anim play and
  // long clips can outlast multiple loop cycles without restacking.
  readonly repeatPerLoop?: boolean;
}

export interface AnimationSoundTriggers {
  readonly triggers: Readonly<Record<string, ReadonlyArray<AnimationTrigger>>>;
}
