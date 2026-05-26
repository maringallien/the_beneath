import triggersRaw from './animationSoundTriggers.json';
import { getSoundDefinition } from './soundRegistryLoader';
import type {
  AnimationSoundTriggers,
  AnimationTrigger,
} from './animationSoundTriggersTypes';

// Validates the on-disk JSON at module load. Fails fast on:
//   - unknown top-level keys
//   - non-array trigger lists
//   - duplicate trigger names within an anim
//   - frameIndex < 1 or non-integer
//   - soundId not declared in soundRegistry.json
// Matches the validation done by tools/anim-sound-aligner/save-plugin.mjs so
// a tool-saved file is guaranteed to load (no asymmetry).

const TRIGGER_NAME_REGEX = /^[A-Za-z0-9_]+$/;
const SOUND_ID_REGEX = /^[A-Za-z0-9_]+$/;
const ANIM_KEY_REGEX = /^[A-Za-z0-9_]+$/;

function validateTrigger(
  ctx: string,
  raw: unknown,
  seenNames: Set<string>,
): AnimationTrigger {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(`${ctx} must be an object`);
  }
  const entry = raw as Record<string, unknown>;
  for (const key of Object.keys(entry)) {
    if (
      key !== 'name' &&
      key !== 'soundId' &&
      key !== 'frameIndex' &&
      key !== 'audioStartOffsetMs' &&
      key !== 'stopOnAnimComplete' &&
      key !== 'repeatPerLoop'
    ) {
      throw new Error(`${ctx} has unexpected key "${key}"`);
    }
  }
  const name = entry.name;
  if (typeof name !== 'string' || !TRIGGER_NAME_REGEX.test(name)) {
    throw new Error(`${ctx}.name must match /^[A-Za-z0-9_]+$/ (got ${JSON.stringify(name)})`);
  }
  if (seenNames.has(name)) {
    throw new Error(`${ctx} has duplicate trigger name "${name}"`);
  }
  seenNames.add(name);
  const soundId = entry.soundId;
  if (typeof soundId !== 'string' || !SOUND_ID_REGEX.test(soundId)) {
    throw new Error(
      `${ctx}.soundId must match /^[A-Za-z0-9_]+$/ (got ${JSON.stringify(soundId)})`,
    );
  }
  if (getSoundDefinition(soundId) === null) {
    throw new Error(
      `${ctx}.soundId references unknown sound "${soundId}" — declare it in soundRegistry.json first`,
    );
  }
  const frameIndex = entry.frameIndex;
  if (
    typeof frameIndex !== 'number' ||
    !Number.isInteger(frameIndex) ||
    frameIndex < 1
  ) {
    throw new Error(
      `${ctx}.frameIndex must be a positive integer (got ${JSON.stringify(frameIndex)})`,
    );
  }
  const audioStartOffsetMsRaw = entry.audioStartOffsetMs;
  let audioStartOffsetMs: number | undefined;
  if (audioStartOffsetMsRaw !== undefined) {
    if (
      typeof audioStartOffsetMsRaw !== 'number' ||
      !Number.isFinite(audioStartOffsetMsRaw) ||
      audioStartOffsetMsRaw < 0
    ) {
      throw new Error(
        `${ctx}.audioStartOffsetMs must be a non-negative number (got ${JSON.stringify(audioStartOffsetMsRaw)})`,
      );
    }
    if (audioStartOffsetMsRaw > 0) audioStartOffsetMs = audioStartOffsetMsRaw;
  }
  const stopOnAnimCompleteRaw = entry.stopOnAnimComplete;
  let stopOnAnimComplete: boolean | undefined;
  if (stopOnAnimCompleteRaw !== undefined) {
    if (typeof stopOnAnimCompleteRaw !== 'boolean') {
      throw new Error(
        `${ctx}.stopOnAnimComplete must be a boolean (got ${JSON.stringify(stopOnAnimCompleteRaw)})`,
      );
    }
    if (stopOnAnimCompleteRaw) stopOnAnimComplete = true;
  }
  const repeatPerLoopRaw = entry.repeatPerLoop;
  let repeatPerLoop: boolean | undefined;
  if (repeatPerLoopRaw !== undefined) {
    if (typeof repeatPerLoopRaw !== 'boolean') {
      throw new Error(
        `${ctx}.repeatPerLoop must be a boolean (got ${JSON.stringify(repeatPerLoopRaw)})`,
      );
    }
    if (repeatPerLoopRaw) repeatPerLoop = true;
  }
  const base = { name, soundId, frameIndex };
  const withOffset =
    audioStartOffsetMs === undefined
      ? base
      : { ...base, audioStartOffsetMs };
  const withStop =
    stopOnAnimComplete === undefined
      ? withOffset
      : { ...withOffset, stopOnAnimComplete };
  return repeatPerLoop === undefined
    ? withStop
    : { ...withStop, repeatPerLoop };
}

const REGISTRY: AnimationSoundTriggers = (() => {
  const raw = triggersRaw as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== 'triggers') {
      throw new Error(
        `animationSoundTriggers.json has unexpected top-level key "${key}"`,
      );
    }
  }
  const triggersField = raw.triggers;
  if (triggersField == null || typeof triggersField !== 'object') {
    throw new Error('animationSoundTriggers.json.triggers must be an object');
  }
  const out: Record<string, ReadonlyArray<AnimationTrigger>> = {};
  for (const [animKey, list] of Object.entries(
    triggersField as Record<string, unknown>,
  )) {
    if (!ANIM_KEY_REGEX.test(animKey)) {
      throw new Error(
        `animationSoundTriggers.json animation key "${animKey}" must match /^[A-Za-z0-9_]+$/`,
      );
    }
    if (!Array.isArray(list)) {
      throw new Error(
        `animationSoundTriggers.json.triggers["${animKey}"] must be an array`,
      );
    }
    const seenNames = new Set<string>();
    const validated: AnimationTrigger[] = list.map((entry, i) =>
      validateTrigger(
        `animationSoundTriggers.json.triggers["${animKey}"][${i}]`,
        entry,
        seenNames,
      ),
    );
    if (validated.length > 0) out[animKey] = Object.freeze(validated);
  }
  return Object.freeze({ triggers: Object.freeze(out) });
})();

const EMPTY: ReadonlyArray<AnimationTrigger> = Object.freeze([]);

// Returns the trigger list bound to a full animation key (the Phaser anim
// key as registered by characterLoader). Returns the empty array when no
// triggers are authored for that anim — callers iterate without a null
// check.
export function getTriggersFor(
  fullAnimKey: string,
): ReadonlyArray<AnimationTrigger> {
  return REGISTRY.triggers[fullAnimKey] ?? EMPTY;
}

// Exposes every (animKey, triggers) pair. Intended for diagnostic tooling
// and future bulk-validation passes; not used on the hot path.
export function listAllTriggers(): ReadonlyArray<
  readonly [string, ReadonlyArray<AnimationTrigger>]
> {
  return Object.entries(REGISTRY.triggers);
}
