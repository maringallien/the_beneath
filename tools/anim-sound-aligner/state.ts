// State for the animation-sound aligner tool. All updates return new
// objects — never mutate in place — matching the resizer's pattern and the
// project's immutable-update rule.

export interface Trigger {
  // Logical name within an animation (e.g. "swing_whoosh"). Unique per anim.
  readonly name: string;
  readonly soundId: string;
  // 1-based, matches Phaser's AnimationFrame.index convention and the
  // `startFrame` values in swordMaster.json. The runtime fires the trigger
  // once when the playhead reaches `frame.index >= frameIndex`.
  readonly frameIndex: number;
  // How far into the audio buffer to seek when firing. Lets the user cut
  // off the head of a sound (e.g., skip a long wind-up so the impact lands
  // on the trigger frame). Omitted/0 = play from start.
  readonly audioStartOffsetMs?: number;
}

export interface AlignerState {
  // All authored triggers, keyed by fullAnimKey (e.g.
  // "sword_master_attack1"). Empty array entries are pruned on each update
  // to keep the JSON output minimal.
  readonly triggersByAnim: ReadonlyMap<string, ReadonlyArray<Trigger>>;
  readonly selectedAnimKey: string | null;
  // Sound id chosen for "new trigger" authoring. Independent of the
  // existing triggers on the current anim (which carry their own soundId).
  readonly selectedSoundId: string | null;
  // Scratch offset shown on the waveform, in whole frames. Negative offsets
  // mean the audio's earlier-in-buffer content lands on frame 0 (i.e., the
  // peak is later in the anim). Used only for visual alignment in the tool;
  // the persisted trigger stores the frame index that's read off this view.
  readonly audioOffsetFrames: number;
  readonly playing: boolean;
  // 1-based playhead position. -1 = before-start / no anim selected.
  readonly currentFrameIndex: number;
}

export const INITIAL_STATE: AlignerState = {
  triggersByAnim: new Map(),
  selectedAnimKey: null,
  selectedSoundId: null,
  // 1 = frame 1 (the start of the anim). Defaulting to a valid trigger
  // frame means the user can save a trigger without dragging the slider
  // first — the common "fire on first frame" case (e.g. attack4) is
  // a single click.
  audioOffsetFrames: 1,
  playing: false,
  currentFrameIndex: -1,
};

export function setSelectedAnim(
  state: AlignerState,
  animKey: string | null,
): AlignerState {
  if (state.selectedAnimKey === animKey) return state;
  return {
    ...state,
    selectedAnimKey: animKey,
    // Reset visual scratch fields on anim swap — offset and playhead are
    // anim-relative and would point at nothing useful on a new selection.
    audioOffsetFrames: 1,
    currentFrameIndex: -1,
    playing: false,
  };
}

export function setSelectedSound(
  state: AlignerState,
  soundId: string | null,
): AlignerState {
  if (state.selectedSoundId === soundId) return state;
  return { ...state, selectedSoundId: soundId };
}

export function setAudioOffsetFrames(
  state: AlignerState,
  offsetFrames: number,
): AlignerState {
  const clean = Number.isFinite(offsetFrames) ? Math.round(offsetFrames) : 0;
  if (state.audioOffsetFrames === clean) return state;
  return { ...state, audioOffsetFrames: clean };
}

export function setPlaying(
  state: AlignerState,
  playing: boolean,
): AlignerState {
  if (state.playing === playing) return state;
  return { ...state, playing };
}

export function setCurrentFrameIndex(
  state: AlignerState,
  frameIndex: number,
): AlignerState {
  if (state.currentFrameIndex === frameIndex) return state;
  return { ...state, currentFrameIndex: frameIndex };
}

// Add a trigger, or replace the one with the matching `name` on this anim.
// Empty animKey entries are never created.
export function addOrUpdateTrigger(
  state: AlignerState,
  animKey: string,
  trigger: Trigger,
): AlignerState {
  const next = new Map(state.triggersByAnim);
  const existing = next.get(animKey) ?? [];
  const filtered = existing.filter((t) => t.name !== trigger.name);
  next.set(animKey, [...filtered, trigger]);
  return { ...state, triggersByAnim: next };
}

export function removeTrigger(
  state: AlignerState,
  animKey: string,
  triggerName: string,
): AlignerState {
  const existing = state.triggersByAnim.get(animKey);
  if (!existing) return state;
  const filtered = existing.filter((t) => t.name !== triggerName);
  const next = new Map(state.triggersByAnim);
  if (filtered.length === 0) {
    next.delete(animKey);
  } else {
    next.set(animKey, filtered);
  }
  return { ...state, triggersByAnim: next };
}

// Replace the entire triggers map. Used when seeding from the on-disk file
// at boot, and when "Reset all" is clicked.
export function setAllTriggers(
  state: AlignerState,
  triggersByAnim: ReadonlyMap<string, ReadonlyArray<Trigger>>,
): AlignerState {
  return { ...state, triggersByAnim };
}

export function getTriggersForAnim(
  state: AlignerState,
  animKey: string,
): ReadonlyArray<Trigger> {
  return state.triggersByAnim.get(animKey) ?? [];
}
