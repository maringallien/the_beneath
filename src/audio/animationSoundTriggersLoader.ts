import triggersRaw from './animationSoundTriggers.json';
import { getSoundDefinition } from './soundRegistryLoader';
import * as v from '../shared/validate';
import type {
  AnimationSoundTriggers,
  AnimationTrigger,
} from './animationSoundTriggersTypes';

/**
 * @file audio/animationSoundTriggersLoader.ts
 * @description Parses, validates, and exposes the frame-synced animation→sound trigger table — builds a frozen registry from animationSoundTriggers.json at module load, keyed by full Phaser anim key. Fails fast on unknown keys, a non-object/array shape, a duplicate name within an anim, an anim-key/name/soundId breaking the A-Za-z0-9_ shape, a non-integer or below-one frameIndex, or a soundId absent from soundRegistry.json. Zero/false optional flags normalize to undefined. Read by the frame-synced playback path (and diagnostic tooling); delegates to the shared validate.* helpers and getSoundDefinition.
 * @module audio
 */

const TRIGGER_NAME_REGEX = /^[A-Za-z0-9_]+$/;
const SOUND_ID_REGEX = /^[A-Za-z0-9_]+$/;
const ANIM_KEY_REGEX = /^[A-Za-z0-9_]+$/;

/**
 * @function    validateTrigger
 * @description Validates one trigger entry into a typed AnimationTrigger — checks keys, the name/soundId shape, name uniqueness, soundId existence, and a positive-int frameIndex; optional flags are included only when meaningfully set.
 * @param   ctx        JSON path prefix for error messages.
 * @param   raw        The unvalidated trigger entry.
 * @param   seenNames  Names already used in this anim's list, for duplicate detection (mutated).
 * @returns the frozen-shape AnimationTrigger carrying only fields that do something.
 * @calledby the REGISTRY build IIFE below, per trigger in each anim's list
 * @calls    the shared validate.* primitives and getSoundDefinition, throwing a path-tagged Error on any bad field
 */
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
  // zero/false normalize to undefined so the parsed trigger only carries fields that do something
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

// built once at module load; a bad JSON file fails the import loudly rather than misfiring at runtime
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

// shared frozen empty list for anims with no triggers
const EMPTY: ReadonlyArray<AnimationTrigger> = Object.freeze([]);

/** Trigger list for an anim key, or the shared empty array so callers iterate without a null check (used by Player/Enemy/Trap on anim-frame update). */
export function getTriggersFor(
  fullAnimKey: string,
): ReadonlyArray<AnimationTrigger> {
  return REGISTRY.triggers[fullAnimKey] ?? EMPTY;
}

/** Every (animKey, triggers) pair; for diagnostics and bulk validation, not on the hot path. */
export function listAllTriggers(): ReadonlyArray<
  readonly [string, ReadonlyArray<AnimationTrigger>]
> {
  return Object.entries(REGISTRY.triggers);
}
