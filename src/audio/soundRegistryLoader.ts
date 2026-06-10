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

const VALID_CATEGORIES: ReadonlySet<SoundCategory> = new Set([
  'ambience',
  'sfx',
  'music',
]);

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

// Slot keys recognized in soundRegistry.playerStateSounds. Kept in sync
// (manually) with the PlayerSoundSlot union in soundRegistryTypes — adding
// a slot means a string here AND in the union.
const PLAYER_SOUND_SLOTS: ReadonlyArray<keyof PlayerStateSounds> = [
  'movement',
  'footstepsGround',
  'footstepsBridge',
  'wallSlide',
  'falling',
];

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

// Walk-sound bindings: one or more spatial looping sound ids per entity
// identifier, gated by Enemy state (walk/chase only). The JSON value may be:
//   - a single string (one always-on walk loop),
//   - an array of strings (layered always-on loops, e.g. a boss with both a
//     footstep track and an impact track),
//   - or an object `{ ground?, bridge? }` for surface-gated footsteps where
//     only the binding matching the IntGrid tile under the enemy's feet fades
//     in (the other surface stays muted). Mix is allowed: an array entry +
//     ground/bridge entries layer always-on loops with surface gating.
// The loader normalizes every form to a binding array. Each referenced sound
// MUST have spatial config AND loop=true — walk sounds are registered muted
// and fade in/out with state changes.
function validateEntityWalkSounds(
  raw: unknown,
  sounds: Readonly<Record<string, SoundDefinition>>,
): Readonly<Record<string, ReadonlyArray<EntityWalkSoundBinding>>> {
  if (raw === undefined) return {};
  const entries = v.requireObject(raw, 'soundRegistry.entityWalkSounds');
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

// Sequence playlists: one ordered list of sound ids per entity. Each
// referenced sound must be spatial (volume needs distance falloff while
// playing at the sprite's position) and non-looping (the playlist loops by
// advancing on COMPLETE; a per-clip loop would never trigger advance).
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

  // entitySounds is optional in the JSON (worlds without any entity-anchored
  // audio can omit the key entirely); default to an empty mapping.
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

export function getAllSoundDefinitions(): ReadonlyArray<
  readonly [string, SoundDefinition]
> {
  return Object.entries(REGISTRY.sounds);
}

export function getSoundDefinition(id: string): SoundDefinition | null {
  return REGISTRY.sounds[id] ?? null;
}

export function getGlobalAmbienceIds(): ReadonlyArray<string> {
  return REGISTRY.globalAmbience;
}

// Returns the override's ambience list if `levelId` is overridden, otherwise
// the global default. SoundManager.setLevelAmbience consumes this.
export function getAmbienceForLevel(levelId: string): ReadonlyArray<string> {
  return REGISTRY.levelOverrides[levelId]?.ambience ?? REGISTRY.globalAmbience;
}

// Lookup the sound ids bound to a given LDtk entity identifier. Returns an
// empty array if the entity has no audio binding. Multiple ids let one entity
// emit a layered soundscape (e.g. light fixture: bulb buzz + insect wings).
export function getEntitySoundIds(
  entityIdentifier: string,
): ReadonlyArray<string> {
  return REGISTRY.entitySounds[entityIdentifier] ?? [];
}

// All LDtk entity identifiers that have an audio binding. GameScene uses
// this to know which entity instances to scan during buildWorld.
export function getBoundEntityIdentifiers(): ReadonlyArray<string> {
  return Object.keys(REGISTRY.entitySounds);
}

// Looking-spatial sound ids bound to a moving entity. Returned as an empty
// array if the entity is unbound. Mirrors getEntitySoundIds but for the
// movingEntitySounds table.
export function getMovingEntitySoundIds(
  entityIdentifier: string,
): ReadonlyArray<string> {
  return REGISTRY.movingEntitySounds[entityIdentifier] ?? [];
}

// Walk-sound bindings for a moving entity (one or more). Empty array when no
// binding exists. Each binding pairs a spatial looping sound id with a
// surface tag (`'always'` / `'ground'` / `'bridge'`). SoundManager
// registers an anchor per binding (all start muted); setEnemyWalkSoundEnabled
// uses the surface tag to gate which anchor fades in during chase, given the
// IntGrid tile under the enemy's feet.
export function getEntityWalkSoundBindings(
  entityIdentifier: string,
): ReadonlyArray<EntityWalkSoundBinding> {
  return REGISTRY.entityWalkSounds[entityIdentifier] ?? [];
}

// Periodic-call bindings for a moving entity (e.g. crow caw). Empty array
// when nothing is configured.
export function getEntityPeriodicSoundBindings(
  entityIdentifier: string,
): ReadonlyArray<PeriodicEntitySoundBinding> {
  return REGISTRY.entityPeriodicSounds[entityIdentifier] ?? [];
}

// Ordered playlist of sound ids the SoundManager loops through for an entity.
// Empty array means no sequence is configured.
export function getEntitySoundSequence(
  entityIdentifier: string,
): ReadonlyArray<string> {
  return REGISTRY.entitySoundSequences[entityIdentifier] ?? [];
}

// Sound id bound to a player-state slot, or null if the registry omits the
// slot. Returned as nullable rather than throwing so the SoundManager toggle
// gracefully degrades into a no-op when a slot is unconfigured.
export function getPlayerStateSoundId(slot: PlayerSoundSlot): string | null {
  return REGISTRY.playerStateSounds[slot] ?? null;
}
