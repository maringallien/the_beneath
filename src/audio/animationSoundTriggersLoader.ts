import triggersRaw from './animationSoundTriggers.json';
import { getSoundDefinition } from './soundRegistryLoader';
import * as v from '../shared/validate';
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
  const entry = v.requireObject(raw, ctx);
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
  const frameIndex = v.requirePositiveInt(entry, 'frameIndex', ctx);
  // Zero/false normalize to undefined so the parsed trigger only carries the
  // optional fields that actually do something.
  const audioStartOffsetMsRaw = v.optionalNonNegative(
    entry,
    'audioStartOffsetMs',
    ctx,
  );
  const audioStartOffsetMs =
    audioStartOffsetMsRaw !== undefined && audioStartOffsetMsRaw > 0
      ? audioStartOffsetMsRaw
      : undefined;
  const stopOnAnimComplete =
    v.optionalBoolean(entry, 'stopOnAnimComplete', ctx) === true
      ? true
      : undefined;
  const repeatPerLoop =
    v.optionalBoolean(entry, 'repeatPerLoop', ctx) === true
      ? true
      : undefined;
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
  const triggersField = v.requireObject(
    raw.triggers,
    'animationSoundTriggers.json.triggers',
  );
  const out: Record<string, ReadonlyArray<AnimationTrigger>> = {};
  for (const [animKey, listRaw] of Object.entries(triggersField)) {
    if (!ANIM_KEY_REGEX.test(animKey)) {
      throw new Error(
        `animationSoundTriggers.json animation key "${animKey}" must match /^[A-Za-z0-9_]+$/`,
      );
    }
    const list = v.requireArray(
      listRaw,
      `animationSoundTriggers.json.triggers["${animKey}"]`,
    );
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
