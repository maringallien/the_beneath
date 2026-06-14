/**
 * @file audio/animationSoundTriggersTypes.ts
 * @description Schema types for animationSoundTriggers.json — a trigger fires a one-shot when an anim reaches a frame threshold; hand-authored and consumed by the loader and the frame-synced playback path (currently the player). Leaf type module, no logic.
 * @module audio
 */

export interface AnimationTrigger {
  // dedup key within an anim so the trigger fires at most once per playthrough
  readonly name: string;
  readonly soundId: string;
  // 1-based (Phaser AnimationFrame.index); fires when frame.index >= frameIndex
  readonly frameIndex: number;
  // ms into the buffer to start playback; omit/0 = from the start
  readonly audioStartOffsetMs?: number;
  // when true, stops the sound on ANIMATION_COMPLETE so it doesn't overhang the anim
  readonly stopOnAnimComplete?: boolean;
  // when true, resets the fired-flag on ANIMATION_REPEAT so it fires every loop iteration
  readonly repeatPerLoop?: boolean;
}

export interface AnimationSoundTriggers {
  readonly triggers: Readonly<Record<string, ReadonlyArray<AnimationTrigger>>>;
}
