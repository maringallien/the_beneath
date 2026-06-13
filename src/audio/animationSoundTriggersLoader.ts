import triggersRaw from './animationSoundTriggers.json';
import { getSoundDefinition } from './soundRegistryLoader';
import * as v from '../shared/validate';
import type {
  AnimationSoundTriggers,
  AnimationTrigger,
} from './animationSoundTriggersTypes';

/**
 * animationSoundTriggersLoader — parses, validates, and exposes the
 * frame-synced animation→sound trigger table.
 *
 * Builds a frozen, validated registry from animationSoundTriggers.json at module
 * load and serves trigger lists keyed by full Phaser anim key. Validation fails
 * fast on: unknown top-level / per-trigger keys, a non-object triggers map or
 * non-array trigger list, a duplicate trigger name within an anim, an anim key or
 * name/soundId that breaks the /^[A-Za-z0-9_]+$/ shape, a non-integer or <1
 * frameIndex, or a soundId not declared in soundRegistry.json. This mirrors the
 * validation in tools/anim-sound-aligner/save-plugin.mjs, so a tool-saved file is
 * guaranteed to load (no asymmetry). Optional fields that are zero/false are
 * normalized to undefined so a parsed trigger only carries flags that do something.
 *
 * Inputs:  the bundled animationSoundTriggers.json and the sound-registry lookup
 *          (to verify each referenced soundId exists).
 * Outputs: a frozen AnimationSoundTriggers registry plus the trigger-lookup
 *          accessors below; throws at load on any malformed entry.
 * @calledby the audio playback layer resolving which sounds fire on which anim
 *           frames, and diagnostic tooling enumerating the table.
 * @calls    the shared validation helpers and the sound-registry definition lookup.
 */

const TRIGGER_NAME_REGEX = /^[A-Za-z0-9_]+$/;
const SOUND_ID_REGEX = /^[A-Za-z0-9_]+$/;
const ANIM_KEY_REGEX = /^[A-Za-z0-9_]+$/;

// validates one trigger entry; optional flags are only included when meaningfully set
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

// returns the trigger list for an anim key, or the shared empty array — so callers can always iterate without a null check
export function getTriggersFor(
  fullAnimKey: string,
): ReadonlyArray<AnimationTrigger> {
  return REGISTRY.triggers[fullAnimKey] ?? EMPTY;
}

// every (animKey, triggers) pair; for diagnostics and bulk validation, not on the hot path
export function listAllTriggers(): ReadonlyArray<
  readonly [string, ReadonlyArray<AnimationTrigger>]
> {
  return Object.entries(REGISTRY.triggers);
}
