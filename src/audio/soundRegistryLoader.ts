import soundRegistryRaw from './soundRegistry.json';
import * as v from '../shared/validate';
import type {
  EntityWalkSoundBinding,
  LevelAmbienceOverride,
  PeriodicEntitySoundBinding,
  PlayerSoundSlot,
  PlayerStateSounds,
  SoundCategory,
  SoundDefinition,
  SoundRegistry,
  SpatialConfig,
  WalkSoundSurface,
} from './soundRegistryTypes';

/**
 * @file audio/soundRegistryLoader.ts
 * @description Validates soundRegistry.json at module load into a frozen SoundRegistry, then exposes the typed lookups the audio layer reads — a malformed entry fails boot loudly with a path-tagged message. The bulk is per-section validators enforcing SoundManager's contracts: every referenced id exists in `sounds`; entitySounds/movingEntitySounds are spatial; entityWalkSounds spatial AND looping (the string | array | {always|ground|bridge} form normalizes to flat surface-tagged bindings); entitySoundSequences spatial AND non-looping (the playlist loops on COMPLETE); entityPeriodicSounds spatial with maxIntervalMs >= minIntervalMs. Read by preload setup and runtime audio code; delegates to the shared validate.* primitives.
 * @module audio
 */

// the three permitted category values
const VALID_CATEGORIES: ReadonlySet<SoundCategory> = new Set([
  'ambience',
  'sfx',
  'music',
]);

/**
 * @function    validateSpatial
 * @description Validates a spatial block — both radii positive, maxRadius greater than minRadius.
 * @param   ctx  JSON path prefix for error messages.
 * @param   raw  The unvalidated spatial object.
 * @returns the typed {minRadius, maxRadius}.
 * @calledby validateSound, for an entry's optional spatial field
 * @calls    the shared validate.* primitives, throwing a path-tagged Error
 */
function validateSpatial(ctx: string, raw: unknown): SpatialConfig {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(`${ctx} must be an object with minRadius/maxRadius`);
  }
  const s = raw as Record<string, unknown>;
  const minRadius = v.requirePositive(s, 'minRadius', ctx);
  const maxRadius = v.requirePositive(s, 'maxRadius', ctx);
  if (maxRadius <= minRadius) {
    throw new Error(
      `${ctx}.maxRadius (${maxRadius}) must be greater than minRadius (${minRadius})`,
    );
  }
  return { minRadius, maxRadius };
}

/**
 * @function    validateSound
 * @description Validates one sounds-map entry into a typed SoundDefinition — path, category, loop, a defaultVolume in [0, 1], optional rate, optional spatial.
 * @param   id   The sound id (the map key), used to tag error messages.
 * @param   raw  The unvalidated entry.
 * @returns the typed SoundDefinition.
 * @calledby the REGISTRY build IIFE below, per entry in the sounds map
 * @calls    the shared validate.* primitives and validateSpatial, throwing a path-tagged Error
 */
function validateSound(id: string, raw: unknown): SoundDefinition {
  const ctx = `soundRegistry.sounds["${id}"]`;
  const entry = v.requireObject(raw, ctx);
  const path = v.requireString(entry, 'path', ctx);
  const category = v.requireOneOf(entry, 'category', ctx, VALID_CATEGORIES);
  const loop = v.requireBoolean(entry, 'loop', ctx);
  const defaultVolume = entry.defaultVolume;
  if (
    typeof defaultVolume !== 'number' ||
    !Number.isFinite(defaultVolume) ||
    defaultVolume < 0 ||
    defaultVolume > 1
  ) {
    throw new Error(
      `${ctx}.defaultVolume must be a number in [0, 1] (got ${JSON.stringify(defaultVolume)})`,
    );
  }
  const rate = v.optionalPositive(entry, 'rate', ctx);
  const spatial =
    entry.spatial === undefined
      ? undefined
      : validateSpatial(`${ctx}.spatial`, entry.spatial);
  return {
    path,
    category,
    loop,
    defaultVolume,
    rate,
    spatial,
  };
}

/**
 * @function    validateIdList
 * @description Validates an array of sound-id strings against knownIds; the error lists the known ids to help spot typos.
 * @param   ctx       JSON path prefix for error messages.
 * @param   raw       The unvalidated value (must be an array).
 * @param   knownIds  The set of declared sound ids to check membership against.
 * @returns the validated id array.
 * @calledby the REGISTRY build IIFE (globalAmbience) and validateLevelOverride
 * @calls    nothing beyond throwing a path-tagged Error
 */
function validateIdList(
  ctx: string,
  raw: unknown,
  knownIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  if (!Array.isArray(raw)) {
    throw new Error(`${ctx} must be an array of sound ids`);
  }
  for (const id of raw) {
    if (typeof id !== 'string') {
      throw new Error(`${ctx} contains a non-string entry: ${JSON.stringify(id)}`);
    }
    if (!knownIds.has(id)) {
      throw new Error(
        `${ctx} references unknown sound id "${id}". Known ids: [${[...knownIds].join(', ')}]`,
      );
    }
  }
  return raw as ReadonlyArray<string>;
}

/**
 * @function    validateLevelOverride
 * @description Validates one level's ambience override — its id list replaces globalAmbience while the player is inside that level.
 * @param   levelId   The level id (the map key), used to tag error messages.
 * @param   raw       The unvalidated override object.
 * @param   knownIds  The set of declared sound ids to check the ambience list against.
 * @returns the typed LevelAmbienceOverride.
 * @calledby the REGISTRY build IIFE below, per level-overrides entry
 * @calls    validateIdList and the shared validate.* primitives
 */
function validateLevelOverride(
  levelId: string,
  raw: unknown,
  knownIds: ReadonlySet<string>,
): LevelAmbienceOverride {
  const entry = v.requireObject(
    raw,
    `soundRegistry.levelOverrides["${levelId}"]`,
  );
  const ambience = validateIdList(
    `soundRegistry.levelOverrides["${levelId}"].ambience`,
    entry.ambience,
    knownIds,
  );
  return { ambience };
}

// keep in sync with PlayerSoundSlot union — adding a slot needs a string here AND in the union
const PLAYER_SOUND_SLOTS: ReadonlyArray<keyof PlayerStateSounds> = [
  'movement',
  'footstepsGround',
  'footstepsBridge',
  'wallSlide',
  'falling',
];

/**
 * @function    validatePlayerStateSounds
 * @description Validates the optional playerStateSounds map — only recognized slots are kept (unrecognized keys are silently ignored); each value must be a known id.
 * @param   raw       The unvalidated map, or undefined when the section is omitted.
 * @param   knownIds  The set of declared sound ids to check each slot value against.
 * @returns the typed PlayerStateSounds (empty object when omitted).
 * @calledby the REGISTRY build IIFE below
 * @calls    the shared validate.* primitives, throwing a path-tagged Error
 */
function validatePlayerStateSounds(
  raw: unknown,
  knownIds: ReadonlySet<string>,
): PlayerStateSounds {
  if (raw === undefined) return {};
  const entry = v.requireObject(raw, 'soundRegistry.playerStateSounds');
  const out: { -readonly [K in keyof PlayerStateSounds]: PlayerStateSounds[K] } = {};
  for (const slot of PLAYER_SOUND_SLOTS) {
    const value = entry[slot];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new Error(
        `soundRegistry.playerStateSounds.${slot} must be a string (got ${JSON.stringify(value)})`,
      );
    }
    if (!knownIds.has(value)) {
      throw new Error(
        `soundRegistry.playerStateSounds.${slot} references unknown sound id "${value}"`,
      );
    }
    out[slot] = value;
  }
  return out;
}

/**
 * @function    validateEntitySoundsMap
 * @description Validates an entity→sound-ids map (entitySounds / movingEntitySounds) — each entity needs a non-empty list, and every referenced id must be known and carry a spatial config.
 * @param   ctx     JSON path prefix for error messages (names which map).
 * @param   raw     The unvalidated map.
 * @param   sounds  The validated sounds map, for id existence + spatial checks.
 * @returns the validated entity→ids map.
 * @calledby the REGISTRY build IIFE below, for entitySounds and movingEntitySounds
 * @calls    the shared validate.* primitives, throwing a path-tagged Error
 */
function validateEntitySoundsMap(
  ctx: string,
  raw: unknown,
  sounds: Readonly<Record<string, SoundDefinition>>,
): Readonly<Record<string, ReadonlyArray<string>>> {
  const entries = v.requireObject(raw, ctx);
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const [entityId, soundIdsRaw] of Object.entries(entries)) {
    if (!Array.isArray(soundIdsRaw)) {
      throw new Error(
        `${ctx}["${entityId}"] must be an array of sound ids`,
      );
    }
    if (soundIdsRaw.length === 0) {
      throw new Error(
        `${ctx}["${entityId}"] must contain at least one sound id`,
      );
    }
    for (const soundId of soundIdsRaw) {
      if (typeof soundId !== 'string') {
        throw new Error(
          `${ctx}["${entityId}"] contains a non-string entry: ${JSON.stringify(soundId)}`,
        );
      }
      const def = sounds[soundId];
      if (def === undefined) {
        throw new Error(
          `${ctx}["${entityId}"] references unknown sound id "${soundId}"`,
        );
      }
      if (def.spatial === undefined) {
        throw new Error(
          `${ctx}["${entityId}"] references "${soundId}", which has no spatial config — entity-attached sounds require minRadius/maxRadius`,
        );
      }
    }
    out[entityId] = soundIdsRaw as ReadonlyArray<string>;
  }
  return out;
}

/**
 * @function    validateEntityWalkSounds
 * @description Validates entityWalkSounds, normalizing the string | array | {always|ground|bridge} authoring forms into flat surface-tagged bindings; every referenced id must be known, spatial, and looping.
 * @param   raw     The unvalidated map, or undefined when the section is omitted.
 * @param   sounds  The validated sounds map, for id existence + spatial + loop checks.
 * @returns the validated entity→walk-binding map (empty object when omitted).
 * @calledby the REGISTRY build IIFE below
 * @calls    the shared validate.* primitives, throwing a path-tagged Error
 */
function validateEntityWalkSounds(
  raw: unknown,
  sounds: Readonly<Record<string, SoundDefinition>>,
): Readonly<Record<string, ReadonlyArray<EntityWalkSoundBinding>>> {
  if (raw === undefined) return {};
  const entries = v.requireObject(raw, 'soundRegistry.entityWalkSounds');
  // per-id check: known id, has spatial, is looping
  const validateRef = (
    entityId: string,
    soundId: string,
    ctx: string,
  ): void => {
    if (typeof soundId !== 'string') {
      throw new Error(
        `soundRegistry.entityWalkSounds["${entityId}"]${ctx} must be a string (got ${JSON.stringify(soundId)})`,
      );
    }
    const def = sounds[soundId];
    if (def === undefined) {
      throw new Error(
        `soundRegistry.entityWalkSounds["${entityId}"]${ctx} references unknown sound id "${soundId}"`,
      );
    }
    if (def.spatial === undefined) {
      throw new Error(
        `soundRegistry.entityWalkSounds["${entityId}"]${ctx} references "${soundId}", which has no spatial config — walk sounds require minRadius/maxRadius`,
      );
    }
    if (!def.loop) {
      throw new Error(
        `soundRegistry.entityWalkSounds["${entityId}"]${ctx} references "${soundId}", which is not looping — walk sounds must loop`,
      );
    }
  };
  const out: Record<string, ReadonlyArray<EntityWalkSoundBinding>> = {};
  for (const [entityId, raw1] of Object.entries(entries)) {
    const bindings: EntityWalkSoundBinding[] = [];
    if (typeof raw1 === 'string') {
      validateRef(entityId, raw1, '');
      bindings.push({ soundId: raw1, surface: 'always' });
    } else if (Array.isArray(raw1)) {
      (raw1 as unknown[]).forEach((v, i) => {
        if (typeof v !== 'string') {
          throw new Error(
            `soundRegistry.entityWalkSounds["${entityId}"][${i}] must be a string (got ${JSON.stringify(v)})`,
          );
        }
        validateRef(entityId, v, `[${i}]`);
        bindings.push({ soundId: v, surface: 'always' });
      });
    } else if (raw1 != null && typeof raw1 === 'object') {
      const obj = raw1 as Record<string, unknown>;
      const allowed: ReadonlyArray<WalkSoundSurface> = [
        'always',
        'ground',
        'bridge',
      ];
      for (const key of Object.keys(obj)) {
        if (!allowed.includes(key as WalkSoundSurface)) {
          throw new Error(
            `soundRegistry.entityWalkSounds["${entityId}"] has unknown key "${key}" (expected one of: ${allowed.join(', ')})`,
          );
        }
      }
      for (const surface of allowed) {
        const val = obj[surface];
        if (val === undefined) continue;
        const ids = Array.isArray(val) ? (val as unknown[]) : [val];
        ids.forEach((v, i) => {
          if (typeof v !== 'string') {
            throw new Error(
              `soundRegistry.entityWalkSounds["${entityId}"].${surface}[${i}] must be a string (got ${JSON.stringify(v)})`,
            );
          }
          validateRef(
            entityId,
            v,
            ids.length === 1 ? `.${surface}` : `.${surface}[${i}]`,
          );
          bindings.push({ soundId: v, surface });
        });
      }
    } else {
      throw new Error(
        `soundRegistry.entityWalkSounds["${entityId}"] must be a string, array of strings, or { ground?, bridge?, always? } object (got ${JSON.stringify(raw1)})`,
      );
    }
    if (bindings.length === 0) {
      throw new Error(
        `soundRegistry.entityWalkSounds["${entityId}"] must reference at least one sound id`,
      );
    }
    out[entityId] = bindings;
  }
  return out;
}

/**
 * @function    validateEntitySoundSequences
 * @description Validates entitySoundSequences — each entity needs a non-empty list, and every id must be known, spatial, and non-looping (the playlist provides the loop by advancing on COMPLETE).
 * @param   raw     The unvalidated map, or undefined when the section is omitted.
 * @param   sounds  The validated sounds map, for id existence + spatial + non-loop checks.
 * @returns the validated entity→sequence map (empty object when omitted).
 * @calledby the REGISTRY build IIFE below
 * @calls    the shared validate.* primitives, throwing a path-tagged Error
 */
function validateEntitySoundSequences(
  raw: unknown,
  sounds: Readonly<Record<string, SoundDefinition>>,
): Readonly<Record<string, ReadonlyArray<string>>> {
  if (raw === undefined) return {};
  const entries = v.requireObject(raw, 'soundRegistry.entitySoundSequences');
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const [entityId, soundIdsRaw] of Object.entries(entries)) {
    if (!Array.isArray(soundIdsRaw)) {
      throw new Error(
        `soundRegistry.entitySoundSequences["${entityId}"] must be an array of sound ids`,
      );
    }
    if (soundIdsRaw.length === 0) {
      throw new Error(
        `soundRegistry.entitySoundSequences["${entityId}"] must contain at least one sound id`,
      );
    }
    for (const soundId of soundIdsRaw) {
      if (typeof soundId !== 'string') {
        throw new Error(
          `soundRegistry.entitySoundSequences["${entityId}"] contains a non-string entry: ${JSON.stringify(soundId)}`,
        );
      }
      const def = sounds[soundId];
      if (def === undefined) {
        throw new Error(
          `soundRegistry.entitySoundSequences["${entityId}"] references unknown sound id "${soundId}"`,
        );
      }
      if (def.spatial === undefined) {
        throw new Error(
          `soundRegistry.entitySoundSequences["${entityId}"] references "${soundId}", which has no spatial config — sequence sounds require minRadius/maxRadius`,
        );
      }
      if (def.loop) {
        throw new Error(
          `soundRegistry.entitySoundSequences["${entityId}"] references "${soundId}", which is set to loop — sequence clips must be one-shot (the sequence handles looping by advancing on COMPLETE)`,
        );
      }
    }
    out[entityId] = soundIdsRaw as ReadonlyArray<string>;
  }
  return out;
}

/**
 * @function    validateEntityPeriodicSounds
 * @description Validates entityPeriodicSounds — each entity needs a non-empty binding list; each soundId must be known and spatial, with minIntervalMs positive and maxIntervalMs >= minIntervalMs.
 * @param   raw     The unvalidated map, or undefined when the section is omitted.
 * @param   sounds  The validated sounds map, for id existence + spatial checks.
 * @returns the validated entity→periodic-binding map (empty object when omitted).
 * @calledby the REGISTRY build IIFE below
 * @calls    the shared validate.* primitives, throwing a path-tagged Error
 */
function validateEntityPeriodicSounds(
  raw: unknown,
  sounds: Readonly<Record<string, SoundDefinition>>,
): Readonly<Record<string, ReadonlyArray<PeriodicEntitySoundBinding>>> {
  if (raw === undefined) return {};
  const entries = v.requireObject(raw, 'soundRegistry.entityPeriodicSounds');
  const out: Record<string, ReadonlyArray<PeriodicEntitySoundBinding>> = {};
  for (const [entityId, bindingsRaw] of Object.entries(entries)) {
    if (!Array.isArray(bindingsRaw)) {
      throw new Error(
        `soundRegistry.entityPeriodicSounds["${entityId}"] must be an array`,
      );
    }
    if (bindingsRaw.length === 0) {
      throw new Error(
        `soundRegistry.entityPeriodicSounds["${entityId}"] must contain at least one binding`,
      );
    }
    const bindings: PeriodicEntitySoundBinding[] = [];
    for (let i = 0; i < bindingsRaw.length; i++) {
      const e = v.requireObject(
        bindingsRaw[i],
        `soundRegistry.entityPeriodicSounds["${entityId}"][${i}]`,
      );
      const soundId = e.soundId;
      if (typeof soundId !== 'string') {
        throw new Error(
          `soundRegistry.entityPeriodicSounds["${entityId}"][${i}].soundId must be a string`,
        );
      }
      const def = sounds[soundId];
      if (def === undefined) {
        throw new Error(
          `soundRegistry.entityPeriodicSounds["${entityId}"][${i}].soundId references unknown sound id "${soundId}"`,
        );
      }
      if (def.spatial === undefined) {
        throw new Error(
          `soundRegistry.entityPeriodicSounds["${entityId}"][${i}].soundId references "${soundId}", which has no spatial config — periodic entity sounds require minRadius/maxRadius for distance gating`,
        );
      }
      const minIntervalMs = v.requirePositive(
        e,
        'minIntervalMs',
        `soundRegistry.entityPeriodicSounds["${entityId}"][${i}]`,
      );
      const maxIntervalMs = e.maxIntervalMs;
      if (typeof maxIntervalMs !== 'number' || maxIntervalMs < minIntervalMs) {
        throw new Error(
          `soundRegistry.entityPeriodicSounds["${entityId}"][${i}].maxIntervalMs must be a number >= minIntervalMs (${minIntervalMs})`,
        );
      }
      bindings.push({ soundId, minIntervalMs, maxIntervalMs });
    }
    out[entityId] = bindings;
  }
  return out;
}

// assembled once at import; sounds validated first so knownIds can cross-check all binding sections; deep-frozen
const REGISTRY: SoundRegistry = (() => {
  const raw = soundRegistryRaw as Record<string, unknown>;

  const soundsRaw = v.requireObject(raw.sounds, 'soundRegistry.sounds');
  const sounds: Record<string, SoundDefinition> = {};
  for (const [id, value] of Object.entries(soundsRaw)) {
    sounds[id] = validateSound(id, value);
  }
  const knownIds = new Set(Object.keys(sounds));

  const globalAmbience = validateIdList(
    'soundRegistry.globalAmbience',
    raw.globalAmbience,
    knownIds,
  );

  const overridesRaw = v.requireObject(
    raw.levelOverrides,
    'soundRegistry.levelOverrides',
  );
  const levelOverrides: Record<string, LevelAmbienceOverride> = {};
  for (const [levelId, value] of Object.entries(overridesRaw)) {
    levelOverrides[levelId] = validateLevelOverride(levelId, value, knownIds);
  }

  // optional sections default to {} when omitted
  const entitySounds =
    raw.entitySounds === undefined
      ? {}
      : validateEntitySoundsMap('soundRegistry.entitySounds', raw.entitySounds, sounds);
  const movingEntitySounds =
    raw.movingEntitySounds === undefined
      ? {}
      : validateEntitySoundsMap(
          'soundRegistry.movingEntitySounds',
          raw.movingEntitySounds,
          sounds,
        );
  const entityWalkSounds = validateEntityWalkSounds(
    raw.entityWalkSounds,
    sounds,
  );
  const entitySoundSequences = validateEntitySoundSequences(
    raw.entitySoundSequences,
    sounds,
  );
  const entityPeriodicSounds = validateEntityPeriodicSounds(
    raw.entityPeriodicSounds,
    sounds,
  );

  const playerStateSounds = validatePlayerStateSounds(
    raw.playerStateSounds,
    knownIds,
  );

  return Object.freeze({
    sounds: Object.freeze(sounds),
    globalAmbience,
    levelOverrides: Object.freeze(levelOverrides),
    entitySounds: Object.freeze(entitySounds),
    movingEntitySounds: Object.freeze(movingEntitySounds),
    entityWalkSounds: Object.freeze(entityWalkSounds),
    entitySoundSequences: Object.freeze(entitySoundSequences),
    entityPeriodicSounds: Object.freeze(entityPeriodicSounds),
    playerStateSounds: Object.freeze(playerStateSounds),
  });
})();

/** Every [id, definition] pair; the preloader walks this to load each audio file. */
export function getAllSoundDefinitions(): ReadonlyArray<
  readonly [string, SoundDefinition]
> {
  return Object.entries(REGISTRY.sounds);
}

/** The definition for a sound id, or null if unregistered. */
export function getSoundDefinition(id: string): SoundDefinition | null {
  return REGISTRY.sounds[id] ?? null;
}

/** Sound ids that play scene-wide from game start (the default ambience bed). */
export function getGlobalAmbienceIds(): ReadonlyArray<string> {
  return REGISTRY.globalAmbience;
}

/** The override ambience for a level, or the global default if not overridden. */
export function getAmbienceForLevel(levelId: string): ReadonlyArray<string> {
  return REGISTRY.levelOverrides[levelId]?.ambience ?? REGISTRY.globalAmbience;
}

/** Static sound ids bound to an LDtk entity identifier; empty if none (multiple ids = layered soundscape). */
export function getEntitySoundIds(
  entityIdentifier: string,
): ReadonlyArray<string> {
  return REGISTRY.entitySounds[entityIdentifier] ?? [];
}

/** All entity identifiers with a static audio binding; used to filter the world-build scan. */
export function getBoundEntityIdentifiers(): ReadonlyArray<string> {
  return Object.keys(REGISTRY.entitySounds);
}

/** Like getEntitySoundIds but for moving entities — anchored to the live sprite position each frame. */
export function getMovingEntitySoundIds(
  entityIdentifier: string,
): ReadonlyArray<string> {
  return REGISTRY.movingEntitySounds[entityIdentifier] ?? [];
}

/** Walk-sound bindings for an entity; each pairs a looping id with a surface tag for chase-state gating. */
export function getEntityWalkSoundBindings(
  entityIdentifier: string,
): ReadonlyArray<EntityWalkSoundBinding> {
  return REGISTRY.entityWalkSounds[entityIdentifier] ?? [];
}

/** Periodic one-shot bindings for an entity (e.g. crow caw); empty when none configured. */
export function getEntityPeriodicSoundBindings(
  entityIdentifier: string,
): ReadonlyArray<PeriodicEntitySoundBinding> {
  return REGISTRY.entityPeriodicSounds[entityIdentifier] ?? [];
}

/** Ordered playlist for an entity that SoundManager advances on COMPLETE; empty = no sequence. */
export function getEntitySoundSequence(
  entityIdentifier: string,
): ReadonlyArray<string> {
  return REGISTRY.entitySoundSequences[entityIdentifier] ?? [];
}

/** Sound id for a player-state slot, or null if unconfigured (so the toggle gracefully no-ops). */
export function getPlayerStateSoundId(slot: PlayerSoundSlot): string | null {
  return REGISTRY.playerStateSounds[slot] ?? null;
}
