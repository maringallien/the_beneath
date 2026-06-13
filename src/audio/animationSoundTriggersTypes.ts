/**
 * animationSoundTriggersTypes — runtime-side shapes for the
 * animationSoundTriggers.json data file.
 *
 * Pure type definitions: the schema for animation-frame-driven sound effects
 * (a trigger fires a one-shot when an animation reaches a frame threshold).
 * Authored by the tools/anim-sound-aligner browser tool and consumed by the
 * entity that plays frame-synced audio (currently the player, plus any future
 * entity needing it).
 *
 * Inputs:  none — declarations only.
 * Outputs: the AnimationTrigger / AnimationSoundTriggers interfaces below.
 * @calledby the audio loader that parses the triggers JSON and the entity code
 *           that fires sounds off animation-frame events.
 * @calls    nothing — a leaf type module.
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
