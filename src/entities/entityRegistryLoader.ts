import entityRegistryRaw from './entityRegistry.json';
import * as v from '../shared/validate';
import type {
  AnimatedEntityAnimConfig,
  AnimatedEntityAttackConfig,
  AnimatedEntityBehaviorConfig,
  AnimatedEntityConfig,
  AnimatedEntityDropConfig,
  AnimatedEntityDropKindConfig,
  AnimatedEntityHitboxConfig,
  AnimatedEntityTrapConfig,
  EntityRegistry,
} from './entityRegistryTypes';

/**
 * entityRegistryLoader — loads and validates entityRegistry.json into typed
 * configs at module load, and serves the frozen result by lookup.
 *
 * The heart of boot-time registry validation. A nest of hand-rolled validators
 * (over the shared validate primitives) turns the raw JSON into the typed
 * AnimatedEntityConfig tree, and the module-scope IIFEs at the bottom run them
 * once at import so an authoring mistake fails the boot loudly — naming the
 * exact JSON path — instead of misbehaving at first spawn (much later in the
 * lifecycle). The DROP_KINDS / ATTACK_TYPES allowlists and every domain rule
 * (per-type field requirements, animation-key cross-checks, range/combo
 * relationships) live here, next to the schema they describe; only the
 * type/range primitives live in ../shared/validate. A recurring contract:
 * every animation key referenced by a field must exist in that entity's own
 * animations map, and a clip that must play to completion (wake, death, any
 * attack wind-up/strike) must be one-shot (loops: false) — a looping clip would
 * trap the entity in 'attack' state and never fire its recover/cleanup path.
 *
 * Inputs:  entityRegistry.json (imported) and the shared validate primitives.
 * Outputs: a frozen typed registry plus lookup helpers and the entity anim-key
 *          namespacing helpers; throws at load on any invalid entry.
 * @calledby the entity spawn / factory and animation code, looking up a config,
 *           behavior, trap, or anim by identifier or full key.
 * @calls    the shared validate primitives, field by field, for each entry.
 */

// namespaces entity anim keys so they can't collide with player keys
const ENTITY_KEY_PREFIX = 'entity';

interface ParsedEntry {
  readonly identifier: string;
  readonly config: AnimatedEntityConfig;
}

// validate one registry entry into a typed config; throws at load if anything is wrong
function validateEntry(
  identifier: string,
  raw: unknown,
): AnimatedEntityConfig {
  const ctx = `entityRegistry["${identifier}"]`;
  const entry = v.requireObject(raw, ctx);
  const defaultAnimation = v.requireString(entry, 'defaultAnimation', ctx);
  const physicsBodyRaw = entry.physicsBody;
  if (physicsBodyRaw == null || typeof physicsBodyRaw !== 'object') {
    throw new Error(`${ctx}.physicsBody must be an object with width/height`);
  }
  const physicsBody = physicsBodyRaw as Record<string, unknown>;
  const bodyWidth = v.requireFinite(physicsBody, 'width', `${ctx}.physicsBody`);
  const bodyHeight = v.requireFinite(
    physicsBody,
    'height',
    `${ctx}.physicsBody`,
  );
  const animationsRaw = v.requireObject(entry.animations, `${ctx}.animations`);
  const animations: Record<string, AnimatedEntityAnimConfig> = {};
  for (const [animKey, animRaw] of Object.entries(animationsRaw)) {
    animations[animKey] = validateAnim(identifier, animKey, animRaw);
  }
  if (!(defaultAnimation in animations)) {
    throw new Error(
      `${ctx}.defaultAnimation "${defaultAnimation}" not present in animations`,
    );
  }
  const behavior =
    entry.behavior === undefined
      ? undefined
      : validateBehavior(identifier, entry.behavior, animations);
  const trap =
    entry.trap === undefined ? undefined : validateTrap(identifier, entry.trap);
  if (behavior && trap) {
    throw new Error(
      `${ctx} has both behavior and trap blocks — pick one. ` +
        'Enemies (with health/AI) use behavior; passive damage sources use trap.',
    );
  }
  const drops =
    entry.drops === undefined ? undefined : validateDrops(identifier, entry.drops);
  return {
    defaultAnimation,
    physicsBody: {
      width: bodyWidth,
      height: bodyHeight,
    },
    gravity: entry.gravity === true,
    animations,
    behavior,
    trap,
    drops,
  };
}

// validate the drops array into typed drop-event configs
function validateDrops(
  identifier: string,
  raw: unknown,
): ReadonlyArray<AnimatedEntityDropConfig> {
  const list = v.requireNonEmptyArray(
    raw,
    `entityRegistry["${identifier}"].drops`,
  );
  const drops: AnimatedEntityDropConfig[] = [];
  for (let i = 0; i < list.length; i += 1) {
    drops.push(validateDropEvent(identifier, i, list[i]));
  }
  return drops;
}

// allowlist of drop kinds; a new pickup/key kind must be added here to be authorable
const DROP_KINDS = [
  'gun1',
  'gun2',
  'magic',
  'coin',
  'heal',
  'key_storms',
  'key_widow',
  'key_heart',
] as const;

// validate one drop event: chancePct in [0,100] and a non-empty weighted kinds table
function validateDropEvent(
  identifier: string,
  index: number,
  raw: unknown,
): AnimatedEntityDropConfig {
  const ctx = `entityRegistry["${identifier}"].drops[${index}]`;
  const d = v.requireObject(raw, ctx);
  const chancePct = d.chancePct;
  if (
    typeof chancePct !== 'number' ||
    !Number.isFinite(chancePct) ||
    chancePct < 0 ||
    chancePct > 100
  ) {
    throw new Error(
      `${ctx}.chancePct must be a number in [0, 100] (got ${JSON.stringify(chancePct)})`,
    );
  }
  const kindsRaw = v.requireNonEmptyArray(d.kinds, `${ctx}.kinds`);
  const kinds: AnimatedEntityDropKindConfig[] = [];
  for (let i = 0; i < kindsRaw.length; i += 1) {
    const e = v.requireObject(kindsRaw[i], `${ctx}.kinds[${i}]`);
    const kind = v.requireOneOf(e, 'kind', `${ctx}.kinds[${i}]`, DROP_KINDS);
    const weight = v.requireNonNegative(e, 'weight', `${ctx}.kinds[${i}]`);
    kinds.push({ kind, weight });
  }
  return { chancePct, kinds };
}

// validate a trap block: positive damage, optional snap anim, optional damage-zone rect
function validateTrap(
  identifier: string,
  raw: unknown,
): AnimatedEntityTrapConfig {
  const ctx = `entityRegistry["${identifier}"].trap`;
  if (raw == null || typeof raw !== 'object') {
    throw new Error(`${ctx} must be an object when set`);
  }
  const t = raw as Record<string, unknown>;
  const damage = v.requirePositive(t, 'damage', ctx);
  let directContactAnimation: string | undefined;
  if (t.directContactAnimation !== undefined) {
    if (typeof t.directContactAnimation !== 'string' || t.directContactAnimation.length === 0) {
      throw new Error(
        `${ctx}.directContactAnimation must be a non-empty animation key when set`,
      );
    }
    directContactAnimation = t.directContactAnimation;
  }
  let damageZone: AnimatedEntityTrapConfig['damageZone'];
  if (t.damageZone !== undefined) {
    if (t.damageZone === null || typeof t.damageZone !== 'object') {
      throw new Error(`${ctx}.damageZone must be an object when set`);
    }
    const z = t.damageZone as Record<string, unknown>;
    const zctx = `${ctx}.damageZone`;
    damageZone = {
      width: v.requirePositive(z, 'width', zctx),
      height: v.requirePositive(z, 'height', zctx),
      offsetX: v.requireFinite(z, 'offsetX', zctx),
      offsetY: v.requireFinite(z, 'offsetY', zctx),
    };
  }
  return { damage, directContactAnimation, damageZone };
}

// validate an enemy behavior block — health required, every anim key cross-checked, all cross-field rules enforced
function validateBehavior(
  identifier: string,
  raw: unknown,
  animations: Readonly<Record<string, AnimatedEntityAnimConfig>>,
): AnimatedEntityBehaviorConfig {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(
      `entityRegistry["${identifier}"].behavior must be an object when set`,
    );
  }
  const b = raw as Record<string, unknown>;
  const ctx = `entityRegistry["${identifier}"].behavior`;

  const health = v.requirePositive(b, 'health', ctx);

  const hurtAnimation = optionalAnimKey(
    ctx,
    'hurtAnimation',
    b.hurtAnimation,
    animations,
  );
  const hurtSoundId = v.optionalString(b, 'hurtSoundId', ctx);
  const encounterSoundId = v.optionalString(b, 'encounterSoundId', ctx);
  const encounterRadius = v.optionalPositive(b, 'encounterRadius', ctx);
  const engageDelayMs = v.optionalNonNegative(b, 'engageDelayMs', ctx);
  if (
    encounterRadius !== undefined &&
    encounterSoundId === undefined &&
    engageDelayMs === undefined
  ) {
    throw new Error(
      `${ctx}.encounterRadius is set but neither encounterSoundId nor engageDelayMs is — the radius has nothing to trigger.`,
    );
  }
  let dormant:
    | {
        readonly wakeAnimation: string;
        readonly trigger: 'lineOfSight';
        readonly range?: number;
        readonly sleepAnimation?: string;
      }
    | undefined;
  if (b.dormant !== undefined) {
    if (b.dormant === null || typeof b.dormant !== 'object') {
      throw new Error(`${ctx}.dormant must be an object when set`);
    }
    const d = b.dormant as Record<string, unknown>;
    const wakeAnimation = requireAnimKeyExists(
      `${ctx}.dormant`,
      'wakeAnimation',
      d.wakeAnimation,
      animations,
    );
    if (animations[wakeAnimation].loops) {
      throw new Error(
        `${ctx}.dormant.wakeAnimation "${wakeAnimation}" must be one-shot (loops: false) — it plays once on waking`,
      );
    }
    if (d.trigger !== 'lineOfSight') {
      throw new Error(
        `${ctx}.dormant.trigger must be "lineOfSight" (got ${JSON.stringify(d.trigger)})`,
      );
    }
    const dormantRange = v.optionalPositive(d, 'range', `${ctx}.dormant`);
    // looping resting pose — unlike wakeAnimation, may loop; no one-shot check
    const sleepAnimation = optionalAnimKey(
      `${ctx}.dormant`,
      'sleepAnimation',
      d.sleepAnimation,
      animations,
    );
    dormant = {
      wakeAnimation,
      trigger: 'lineOfSight',
      range: dormantRange,
      sleepAnimation,
    };
  }
  const deathAnimation = optionalAnimKey(
    ctx,
    'deathAnimation',
    b.deathAnimation,
    animations,
  );
  const immovable = v.optionalBoolean(b, 'immovable', ctx);
  const horizontalMovementOnly = v.optionalBoolean(
    b,
    'horizontalMovementOnly',
    ctx,
  );
  const stayInSpawnLevel = v.optionalBoolean(b, 'stayInSpawnLevel', ctx);
  const homeLeashRange = v.optionalPositive(b, 'homeLeashRange', ctx);
  // stealth/detection knobs — all optional; runtime applies global defaults when absent
  const detectionRange = v.optionalPositive(b, 'detectionRange', ctx);
  let visionHalfAngleDeg: number | undefined;
  if (b.visionHalfAngleDeg !== undefined) {
    if (
      typeof b.visionHalfAngleDeg !== 'number' ||
      !Number.isFinite(b.visionHalfAngleDeg) ||
      b.visionHalfAngleDeg <= 0 ||
      b.visionHalfAngleDeg > 180
    ) {
      throw new Error(
        `${ctx}.visionHalfAngleDeg must be a number in (0, 180] when set (got ${JSON.stringify(b.visionHalfAngleDeg)})`,
      );
    }
    visionHalfAngleDeg = b.visionHalfAngleDeg;
  }
  const alertSpeedMul = v.optionalPositive(b, 'alertSpeedMul', ctx);
  const ignoresStealth = v.optionalBoolean(b, 'ignoresStealth', ctx);
  const isBoss = v.optionalBoolean(b, 'isBoss', ctx);
  const stationary = v.optionalBoolean(b, 'stationary', ctx);
  const roundFight = v.optionalBoolean(b, 'roundFight', ctx);
  const displayName = v.optionalString(b, 'displayName', ctx);
  const hideHealthBar = v.optionalBoolean(b, 'hideHealthBar', ctx);
  const healthBarOffsetY = v.optionalFinite(b, 'healthBarOffsetY', ctx);
  // behavior-level walk for patrol; attacks[0] overrides, but spirit walkers have no attacks
  const walkAnimation = optionalAnimKey(
    ctx,
    'walkAnimation',
    b.walkAnimation,
    animations,
  );
  const moveSpeed = v.optionalPositive(b, 'moveSpeed', ctx);

  const attack =
    b.attack === undefined
      ? undefined
      : validateAttack(identifier, b.attack, animations);

  let attackPool: ReadonlyArray<AnimatedEntityAttackConfig> | undefined;
  if (b.attackPool !== undefined) {
    if (!Array.isArray(b.attackPool)) {
      throw new Error(`${ctx}.attackPool must be an array when set`);
    }
    if (b.attackPool.length === 0) {
      throw new Error(
        `${ctx}.attackPool is empty — drop the field or add at least one entry. Use the single \`attack\` field for one-attack enemies.`,
      );
    }
    attackPool = b.attackPool.map((entry) =>
      validateAttack(identifier, entry, animations),
    );
  }

  let dodgeOnProjectile:
    | {
        readonly triggerRangePx: number;
        readonly cooldownMs: number;
      }
    | undefined;
  if (b.dodgeOnProjectile !== undefined) {
    if (
      b.dodgeOnProjectile === null ||
      typeof b.dodgeOnProjectile !== 'object'
    ) {
      throw new Error(`${ctx}.dodgeOnProjectile must be an object when set`);
    }
    const d = b.dodgeOnProjectile as Record<string, unknown>;
    const dctx = `${ctx}.dodgeOnProjectile`;
    dodgeOnProjectile = {
      triggerRangePx: v.requirePositive(d, 'triggerRangePx', dctx),
      cooldownMs: v.requirePositive(d, 'cooldownMs', dctx),
    };
  }

  let deathExplosion:
    | {
        readonly damage: number;
        readonly radius: number;
        readonly frame: number;
      }
    | undefined;
  if (b.deathExplosion !== undefined) {
    if (b.deathExplosion === null || typeof b.deathExplosion !== 'object') {
      throw new Error(`${ctx}.deathExplosion must be an object when set`);
    }
    const e = b.deathExplosion as Record<string, unknown>;
    const ectx = `${ctx}.deathExplosion`;
    const frameRaw = v.requireNonNegativeInt(e, 'frame', ectx);
    // without a death anim the runtime fires on enterDeadState; frame is still required for authoring clarity
    const deathAnimKey = deathAnimation ?? 'death';
    if (deathAnimKey in animations) {
      const frameCount = animations[deathAnimKey].frameCount;
      if (frameRaw >= frameCount) {
        throw new Error(
          `${ectx}.frame ${frameRaw} is out of range for "${deathAnimKey}" (frameCount=${frameCount})`,
        );
      }
    }
    deathExplosion = {
      damage: v.requirePositive(e, 'damage', ectx),
      radius: v.requirePositive(e, 'radius', ectx),
      frame: frameRaw,
    };
  }

  let wander:
    | {
        readonly radius: number;
        readonly greet?: {
          readonly group: string;
          readonly proximityPx: number;
          readonly chance: number;
          readonly hops: number;
          readonly cooldownMs: number;
        };
      }
    | undefined;
  if (b.wander !== undefined) {
    if (b.wander === null || typeof b.wander !== 'object') {
      throw new Error(`${ctx}.wander must be an object when set`);
    }
    const w = b.wander as Record<string, unknown>;
    const wctx = `${ctx}.wander`;
    const radiusRaw = v.requirePositive(w, 'radius', wctx);
    let greet:
      | {
          readonly group: string;
          readonly proximityPx: number;
          readonly chance: number;
          readonly hops: number;
          readonly cooldownMs: number;
        }
      | undefined;
    if (w.greet !== undefined) {
      if (w.greet === null || typeof w.greet !== 'object') {
        throw new Error(`${wctx}.greet must be an object when set`);
      }
      const g = w.greet as Record<string, unknown>;
      const gctx = `${wctx}.greet`;
      const group = v.requireString(g, 'group', gctx);
      const chanceRaw = g.chance;
      if (
        typeof chanceRaw !== 'number' ||
        !Number.isFinite(chanceRaw) ||
        chanceRaw <= 0 ||
        chanceRaw > 1
      ) {
        throw new Error(
          `${gctx}.chance must be a number in (0, 1] (got ${JSON.stringify(chanceRaw)})`,
        );
      }
      greet = {
        group,
        proximityPx: v.requirePositive(g, 'proximityPx', gctx),
        chance: chanceRaw,
        hops: v.requirePositiveInt(g, 'hops', gctx),
        cooldownMs: v.requirePositive(g, 'cooldownMs', gctx),
      };
    }
    wander = { radius: radiusRaw, greet };
  }

  return {
    health,
    hurtAnimation,
    hurtSoundId,
    encounterSoundId,
    encounterRadius,
    engageDelayMs,
    dormant,
    deathAnimation,
    immovable,
    stationary,
    horizontalMovementOnly,
    stayInSpawnLevel,
    homeLeashRange,
    detectionRange,
    visionHalfAngleDeg,
    alertSpeedMul,
    ignoresStealth,
    isBoss,
    roundFight,
    displayName,
    hideHealthBar,
    healthBarOffsetY,
    walkAnimation,
    moveSpeed,
    attack,
    attackPool,
    dodgeOnProjectile,
    deathExplosion,
    wander,
  };
}

// allowlist of attack types; selects per-type field requirements in the validator below
const ATTACK_TYPES = [
  'melee',
  'ranged',
  'magic',
  'contact',
  'heal',
  'dive',
  'aoe',
  'teleport',
  'summon',
] as const;

// validate one attack config — type-driven field requirements, anim key cross-checks, placement guards
function validateAttack(
  identifier: string,
  raw: unknown,
  animations: Readonly<Record<string, AnimatedEntityAnimConfig>>,
): AnimatedEntityAttackConfig {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(
      `entityRegistry["${identifier}"].behavior.attack must be an object when set`,
    );
  }
  const a = raw as Record<string, unknown>;
  const ctx = `entityRegistry["${identifier}"].behavior.attack`;

  const type = v.requireOneOf(a, 'type', ctx, ATTACK_TYPES);

  // thin bindings so the many call sites below stay one-argument
  const requirePositive = (field: string): number =>
    v.requirePositive(a, field, ctx);
  const requireNonNegativeInt = (field: string): number =>
    v.requireNonNegativeInt(a, field, ctx);
  const optionalPositive = (field: string): number | undefined =>
    v.optionalPositive(a, field, ctx);
  const optionalFraction = (field: string): number | undefined =>
    v.optionalFraction(a, field, ctx);

  const cooldownMs = requirePositive('cooldownMs');
  const recastCooldownMs = optionalPositive('recastCooldownMs');
  const weight = optionalPositive('weight');
  const aggressive = v.requireBoolean(a, 'aggressive', ctx);

  const chaseRange = optionalPositive('chaseRange');
  const moveSpeed = optionalPositive('moveSpeed');
  const walkAnimation = optionalAnimKey(
    ctx,
    'walkAnimation',
    a.walkAnimation,
    animations,
  );

  // per-type fields — unused stay undefined so consumer code can rely on type-driven branches
  let animation: string | undefined;
  let frame: number | undefined;
  let damage: number | undefined;
  let heal: number | undefined;
  let healThreshold: number | undefined;
  let range: number | undefined;
  let minRange: number | undefined;
  let hitboxes: ReadonlyArray<AnimatedEntityHitboxConfig> | undefined;
  let projectileAnimIdle: string | undefined;
  let projectileAnimExplode: string | undefined;
  let projectileSpeed: number | undefined;
  let projectileOriginX: number | undefined;
  let projectileOriginY: number | undefined;
  let projectileStraight: boolean | undefined;
  let verticalAlignMarginPx: number | undefined;
  let vfxAnimation: string | undefined;
  let damageFrames: ReadonlyArray<number> | undefined;
  let requireGroundedTarget: boolean | undefined;
  let minAirborneDodgeClearancePx: number | undefined;
  let requireOpenSky: boolean | undefined;
  let groundProjectVfx: boolean | undefined;
  let vfxDelayMs: number | undefined;
  let vfxSoundId: string | undefined;
  let vfxSoundLeadMs: number | undefined;
  let hurtSource: 'melee' | 'projectile' | undefined;
  let disappearAnimation: string | undefined;
  let appearAnimation: string | undefined;
  let targetOffsetY: number | undefined;
  let appearElevated: boolean | undefined;
  let comboNextAnimation: string | undefined;
  let comboChancePct: number | undefined;
  let comboOnly: boolean | undefined;
  let lungeDistance: number | undefined;
  let summonKinds: ReadonlyArray<string> | undefined;
  let summonCount: number | undefined;
  let summonMaxAlive: number | undefined;

  // parsed up front so the melee/ranged/magic branch can relax the `range` requirement for comboOnly
  comboOnly = v.optionalBoolean(a, 'comboOnly', ctx);

  // hitbox parser shared by melee and teleport; accepts hitbox (single) or hitboxes (array)
  const parseSingleHitbox = (
    raw: unknown,
    label: string,
  ): AnimatedEntityHitboxConfig => {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(
        `${ctx}.${label} must be an object with offsetX/offsetY/width/height`,
      );
    }
    const hb = raw as Record<string, unknown>;
    const hbctx = `${ctx}.${label}`;
    const matchBody = v.optionalBoolean(hb, 'matchBody', hbctx);
    const hbWidth = v.requireFinite(hb, 'width', hbctx);
    const hbHeight = v.requireFinite(hb, 'height', hbctx);
    // matchBody stamps the live body rect, so 0 dims are allowed; others must be positive
    if (!matchBody && (hbWidth <= 0 || hbHeight <= 0)) {
      throw new Error(
        `${hbctx}.width and height must be > 0 (got ${hbWidth}x${hbHeight})`,
      );
    }
    const hbFrame = v.optionalNonNegativeInt(hb, 'frame', hbctx);
    return {
      offsetX: v.requireFinite(hb, 'offsetX', hbctx),
      offsetY: v.requireFinite(hb, 'offsetY', hbctx),
      width: hbWidth,
      height: hbHeight,
      frame: hbFrame,
      matchBody,
    };
  };
  const parseHitbox = (): ReadonlyArray<AnimatedEntityHitboxConfig> => {
    if (a.hitbox !== undefined && a.hitboxes !== undefined) {
      throw new Error(
        `${ctx}: set either "hitbox" (single) or "hitboxes" (array), not both`,
      );
    }
    let parsed: AnimatedEntityHitboxConfig[];
    if (Array.isArray(a.hitboxes)) {
      if (a.hitboxes.length === 0) {
        throw new Error(
          `${ctx}.hitboxes must contain at least one hitbox`,
        );
      }
      parsed = a.hitboxes.map((h, i) => parseSingleHitbox(h, `hitboxes[${i}]`));
    } else if (a.hitbox !== undefined) {
      parsed = [parseSingleHitbox(a.hitbox, 'hitbox')];
    } else {
      throw new Error(
        `${ctx}.hitbox or .hitboxes is required for type "${type}"`,
      );
    }
    // per-hitbox frame must reference a valid frame of the attack anim (typo → boot error)
    if (animation !== undefined) {
      const frameCount = animations[animation].frameCount;
      for (let i = 0; i < parsed.length; i++) {
        const f = parsed[i].frame;
        if (f !== undefined && f >= frameCount) {
          throw new Error(
            `${ctx}.hitboxes[${i}].frame ${f} is out of range for "${animation}" (frameCount=${frameCount})`,
          );
        }
      }
    }
    return parsed;
  };

  if (type === 'contact') {
    // no anim/frame/range — damage on body overlap, cooldown gates re-damage
    damage = requirePositive('damage');
  } else if (type === 'aoe') {
    // wind-up anim with a VFX spawn on the damage frame; one-shot-checked below
    animation = requireAnimKeyExists(ctx, 'animation', a.animation, animations);
    // exactly one of frame (single-fire) or damageFrames (multi-fire)
    if (a.frame !== undefined && a.damageFrames !== undefined) {
      throw new Error(
        `${ctx}: set either "frame" (single-fire) or "damageFrames" (multi-fire), not both`,
      );
    }
    if (a.frame === undefined && a.damageFrames === undefined) {
      throw new Error(
        `${ctx}: AoE requires either "frame" or "damageFrames" to mark damage-frame(s)`,
      );
    }
    if (a.frame !== undefined) {
      frame = requireNonNegativeInt('frame');
      if (frame >= animations[animation].frameCount) {
        throw new Error(
          `${ctx}.frame ${frame} is out of range for "${animation}" (frameCount=${animations[animation].frameCount})`,
        );
      }
    } else {
      if (!Array.isArray(a.damageFrames) || a.damageFrames.length === 0) {
        throw new Error(
          `${ctx}.damageFrames must be a non-empty array of frame indices`,
        );
      }
      const frameCount = animations[animation].frameCount;
      const seen = new Set<number>();
      for (let i = 0; i < a.damageFrames.length; i++) {
        const f = a.damageFrames[i];
        if (typeof f !== 'number' || !Number.isInteger(f) || f < 0) {
          throw new Error(
            `${ctx}.damageFrames[${i}] must be a non-negative integer (got ${JSON.stringify(f)})`,
          );
        }
        if (f >= frameCount) {
          throw new Error(
            `${ctx}.damageFrames[${i}] (${f}) is out of range for "${animation}" (frameCount=${frameCount})`,
          );
        }
        if (seen.has(f)) {
          throw new Error(
            `${ctx}.damageFrames contains duplicate frame index ${f}`,
          );
        }
        seen.add(f);
      }
      // ascending order so onAnimUpdate's "earliest unfired" walk is just array order
      damageFrames = [...a.damageFrames as number[]].sort((p, q) => p - q);
    }
    if (animations[animation].loops) {
      throw new Error(
        `${ctx}.animation "${animation}" must be one-shot (loops: false) — an AoE wind-up that loops forever would trap the enemy in 'attack' state`,
      );
    }
    damage = requirePositive('damage');
    range = requirePositive('range');
    minRange = optionalPositive('minRange');
    if (minRange !== undefined && minRange >= range) {
      throw new Error(
        `${ctx}.minRange (${minRange}) must be less than range (${range})`,
      );
    }
    vfxAnimation = optionalAnimKey(
      ctx,
      'vfxAnimation',
      a.vfxAnimation,
      animations,
    );
    if (vfxAnimation !== undefined && animations[vfxAnimation].loops) {
      throw new Error(
        `${ctx}.vfxAnimation "${vfxAnimation}" must be one-shot (loops: false) — the VFX sprite self-destroys on ANIMATION_COMPLETE`,
      );
    }
    if (vfxAnimation === undefined && a.groundProjectVfx === true) {
      throw new Error(
        `${ctx}.groundProjectVfx requires vfxAnimation — without a VFX sprite there's nothing to anchor on the projected ground point`,
      );
    }
  } else if (type === 'dive') {
    // animated body-velocity lunge; damage on body overlap during the dive
    animation = requireAnimKeyExists(ctx, 'animation', a.animation, animations);
    if (animations[animation].loops) {
      throw new Error(
        `${ctx}.animation "${animation}" must be one-shot (loops: false) — a dive that loops forever would trap the enemy in 'attack' state`,
      );
    }
    damage = requirePositive('damage');
    range = requirePositive('range');
    minRange = optionalPositive('minRange');
    if (minRange !== undefined && minRange >= range) {
      throw new Error(
        `${ctx}.minRange (${minRange}) must be less than range (${range})`,
      );
    }
  } else if (type === 'heal') {
    animation = requireAnimKeyExists(ctx, 'animation', a.animation, animations);
    frame = requireNonNegativeInt('frame');
    if (frame >= animations[animation].frameCount) {
      throw new Error(
        `${ctx}.frame ${frame} is out of range for "${animation}" (frameCount=${animations[animation].frameCount})`,
      );
    }
    if (animations[animation].loops) {
      throw new Error(
        `${ctx}.animation "${animation}" must be one-shot (loops: false) — a heal that loops forever would trap the enemy in 'attack' state`,
      );
    }
    heal = requirePositive('heal');
    healThreshold = optionalFraction('healThreshold');
  } else if (type === 'teleport') {
    // disappear → optional appear → strike; strike `frame` is the damage frame
    disappearAnimation = requireAnimKeyExists(
      ctx,
      'disappearAnimation',
      a.disappearAnimation,
      animations,
    );
    if (animations[disappearAnimation].loops) {
      throw new Error(
        `${ctx}.disappearAnimation "${disappearAnimation}" must be one-shot (loops: false) — a looping wind-up would never trigger the destination teleport`,
      );
    }
    if (a.appearAnimation !== undefined) {
      appearAnimation = requireAnimKeyExists(
        ctx,
        'appearAnimation',
        a.appearAnimation,
        animations,
      );
      if (animations[appearAnimation].loops) {
        throw new Error(
          `${ctx}.appearAnimation "${appearAnimation}" must be one-shot (loops: false) — a looping reappear would never advance to the strike clip`,
        );
      }
    }
    animation = requireAnimKeyExists(ctx, 'animation', a.animation, animations);
    if (animations[animation].loops) {
      throw new Error(
        `${ctx}.animation "${animation}" must be one-shot (loops: false) — the teleport strike clip must complete to release the entity back to recover`,
      );
    }
    frame = requireNonNegativeInt('frame');
    if (frame >= animations[animation].frameCount) {
      throw new Error(
        `${ctx}.frame ${frame} is out of range for strike "${animation}" (frameCount=${animations[animation].frameCount})`,
      );
    }
    damage = requirePositive('damage');
    range = requirePositive('range');
    minRange = optionalPositive('minRange');
    if (minRange !== undefined && minRange >= range) {
      throw new Error(
        `${ctx}.minRange (${minRange}) must be less than range (${range})`,
      );
    }
    hitboxes = parseHitbox();
    targetOffsetY = v.optionalFinite(a, 'targetOffsetY', ctx);
    appearElevated = v.optionalBoolean(a, 'appearElevated', ctx);
    if (appearElevated === true && appearAnimation === undefined) {
      throw new Error(
        `${ctx}.appearElevated:true requires appearAnimation to be set — the elevation is only meaningful for three-phase teleports`,
      );
    }
  } else if (type === 'summon') {
    // one-shot cast; spawns minions on `frame`; summonKinds existence deferred to runtime
    animation = requireAnimKeyExists(ctx, 'animation', a.animation, animations);
    frame = requireNonNegativeInt('frame');
    if (frame >= animations[animation].frameCount) {
      throw new Error(
        `${ctx}.frame ${frame} is out of range for "${animation}" (frameCount=${animations[animation].frameCount})`,
      );
    }
    if (animations[animation].loops) {
      throw new Error(
        `${ctx}.animation "${animation}" must be one-shot (loops: false) — a summon cast that loops forever would trap the enemy in 'attack' state`,
      );
    }
    range = requirePositive('range');
    if (!Array.isArray(a.summonKinds) || a.summonKinds.length === 0) {
      throw new Error(
        `${ctx}.summonKinds must be a non-empty array of registry identifiers`,
      );
    }
    const kinds: string[] = [];
    for (let i = 0; i < a.summonKinds.length; i++) {
      const k = a.summonKinds[i];
      if (typeof k !== 'string' || k.length === 0) {
        throw new Error(
          `${ctx}.summonKinds[${i}] must be a non-empty string (got ${JSON.stringify(k)})`,
        );
      }
      kinds.push(k);
    }
    summonKinds = kinds;
    summonCount = v.requirePositiveInt(a, 'summonCount', ctx);
    summonMaxAlive = v.optionalPositiveInt(a, 'summonMaxAlive', ctx);
  } else {
    // melee / ranged / magic — animated, frame-gated, range-checked
    animation = requireAnimKeyExists(ctx, 'animation', a.animation, animations);
    frame = requireNonNegativeInt('frame');
    if (frame >= animations[animation].frameCount) {
      throw new Error(
        `${ctx}.frame ${frame} is out of range for "${animation}" (frameCount=${animations[animation].frameCount})`,
      );
    }
    if (animations[animation].loops) {
      throw new Error(
        `${ctx}.animation "${animation}" must be one-shot (loops: false) — an attack that loops forever would trap the enemy in 'attack' state`,
      );
    }
    damage = requirePositive('damage');
    // comboOnly attacks inherit range from the lead; every other attack requires one
    if (comboOnly === true) {
      range = optionalPositive('range');
    } else {
      range = requirePositive('range');
    }
    minRange = optionalPositive('minRange');
    if (minRange !== undefined && range !== undefined && minRange >= range) {
      throw new Error(
        `${ctx}.minRange (${minRange}) must be less than range (${range})`,
      );
    }

    if (type === 'melee') {
      hitboxes = parseHitbox();
      lungeDistance = optionalPositive('lungeDistance');
    } else {
      projectileAnimIdle = requireAnimKeyExists(
        ctx,
        'projectileAnimIdle',
        a.projectileAnimIdle,
        animations,
      );
      projectileAnimExplode = requireAnimKeyExists(
        ctx,
        'projectileAnimExplode',
        a.projectileAnimExplode,
        animations,
      );
      projectileSpeed = requirePositive('projectileSpeed');
      projectileOriginX = v.optionalFinite(a, 'projectileOriginX', ctx);
      projectileOriginY = v.optionalFinite(a, 'projectileOriginY', ctx);
      projectileStraight = v.optionalBoolean(a, 'projectileStraight', ctx);
      verticalAlignMarginPx = v.optionalFinite(a, 'verticalAlignMarginPx', ctx);
      if (
        verticalAlignMarginPx !== undefined &&
        (verticalAlignMarginPx < 0 || projectileStraight !== true)
      ) {
        throw new Error(
          `${ctx}.verticalAlignMarginPx requires projectileStraight=true and must be >= 0 (got ${JSON.stringify(a.verticalAlignMarginPx)})`,
        );
      }
    }
  }

  if (
    type !== 'ranged' &&
    type !== 'magic' &&
    (a.projectileOriginX !== undefined ||
      a.projectileOriginY !== undefined ||
      a.projectileStraight !== undefined ||
      a.verticalAlignMarginPx !== undefined)
  ) {
    throw new Error(
      `${ctx}.projectileOriginX/Y/projectileStraight/verticalAlignMarginPx are only valid on type "ranged" or "magic" (got type "${type}")`,
    );
  }

  // rejects AoE-only fields on other types so a typo fails at boot rather than silently no-opping
  const requireAoeOnly = (field: string): void => {
    if (a[field] !== undefined && type !== 'aoe') {
      throw new Error(
        `${ctx}.${field} is only valid on type "aoe" (got type "${type}")`,
      );
    }
  };
  requireAoeOnly('requireGroundedTarget');
  requireGroundedTarget = v.optionalBoolean(a, 'requireGroundedTarget', ctx);

  requireAoeOnly('minAirborneDodgeClearancePx');
  minAirborneDodgeClearancePx = v.optionalPositive(
    a,
    'minAirborneDodgeClearancePx',
    ctx,
  );
  if (
    minAirborneDodgeClearancePx !== undefined &&
    a.requireGroundedTarget !== true
  ) {
    throw new Error(
      `${ctx}.minAirborneDodgeClearancePx requires requireGroundedTarget=true to take effect`,
    );
  }

  requireAoeOnly('requireOpenSky');
  requireOpenSky = v.optionalBoolean(a, 'requireOpenSky', ctx);

  requireAoeOnly('groundProjectVfx');
  groundProjectVfx = v.optionalBoolean(a, 'groundProjectVfx', ctx);
  if (a.requireGroundedTarget === true && groundProjectVfx === true) {
    throw new Error(
      `${ctx} cannot set both requireGroundedTarget and groundProjectVfx — they describe opposite mid-air behaviors (suppress vs reproject)`,
    );
  }

  requireAoeOnly('vfxDelayMs');
  vfxDelayMs = v.optionalNonNegative(a, 'vfxDelayMs', ctx);

  requireAoeOnly('vfxSoundId');
  vfxSoundId = v.optionalString(a, 'vfxSoundId', ctx);

  requireAoeOnly('vfxSoundLeadMs');
  vfxSoundLeadMs = v.optionalNonNegative(a, 'vfxSoundLeadMs', ctx);
  if (vfxSoundLeadMs !== undefined && vfxSoundId === undefined) {
    throw new Error(
      `${ctx}.vfxSoundLeadMs requires vfxSoundId to also be set`,
    );
  }

  requireAoeOnly('hurtSource');
  if (a.hurtSource !== undefined) {
    hurtSource = v.requireOneOf(a, 'hurtSource', ctx, [
      'melee',
      'projectile',
    ] as const);
  }

  // combo chaining only valid for melee/ranged/magic (standard complete→recover path)
  if (a.comboNextAnimation !== undefined) {
    if (type !== 'melee' && type !== 'ranged' && type !== 'magic') {
      throw new Error(
        `${ctx}.comboNextAnimation is only valid on type "melee" | "ranged" | "magic" (got type "${type}")`,
      );
    }
    // existence-check the anim key; cross-checking vs. the pool is deferred to runtime
    comboNextAnimation = optionalAnimKey(
      ctx,
      'comboNextAnimation',
      a.comboNextAnimation,
      animations,
    );
    if (
      typeof a.comboChancePct !== 'number' ||
      !Number.isFinite(a.comboChancePct) ||
      a.comboChancePct <= 0 ||
      a.comboChancePct > 100
    ) {
      throw new Error(
        `${ctx}.comboChancePct must be a number in (0, 100] when comboNextAnimation is set (got ${JSON.stringify(a.comboChancePct)})`,
      );
    }
    comboChancePct = a.comboChancePct;
  } else if (a.comboChancePct !== undefined) {
    throw new Error(
      `${ctx}.comboChancePct requires comboNextAnimation to also be set`,
    );
  }

  if (comboOnly !== undefined && type !== 'melee' && type !== 'ranged' && type !== 'magic') {
    throw new Error(
      `${ctx}.comboOnly is only valid on type "melee" | "ranged" | "magic" (got type "${type}")`,
    );
  }

  if (a.lungeDistance !== undefined && type !== 'melee') {
    throw new Error(
      `${ctx}.lungeDistance is only valid on type "melee" (got type "${type}")`,
    );
  }

  if (type !== 'summon') {
    for (const field of ['summonKinds', 'summonCount', 'summonMaxAlive'] as const) {
      if (a[field] !== undefined) {
        throw new Error(
          `${ctx}.${field} is only valid on type "summon" (got type "${type}")`,
        );
      }
    }
  }

  const validateAoeHalfDim = (field: 'damageHalfWidth' | 'damageHalfHeight'): number | undefined => {
    if (a[field] === undefined) return undefined;
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.${field} is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (vfxAnimation !== undefined) {
      throw new Error(
        `${ctx}.${field} is only consulted on sprite-less AoEs (vfxAnimation unset) — the VFX path damages via sprite overlap, not overlapRect`,
      );
    }
    return v.requirePositive(a, field, ctx);
  };
  const damageHalfWidth = validateAoeHalfDim('damageHalfWidth');
  const damageHalfHeight = validateAoeHalfDim('damageHalfHeight');

  return {
    type,
    animation,
    frame,
    damageFrames,
    damage,
    heal,
    healThreshold,
    range,
    minRange,
    cooldownMs,
    recastCooldownMs,
    weight,
    aggressive,
    chaseRange,
    moveSpeed,
    walkAnimation,
    hitboxes,
    projectileAnimIdle,
    projectileAnimExplode,
    projectileSpeed,
    projectileOriginX,
    projectileOriginY,
    projectileStraight,
    verticalAlignMarginPx,
    vfxAnimation,
    requireGroundedTarget,
    minAirborneDodgeClearancePx,
    requireOpenSky,
    groundProjectVfx,
    vfxDelayMs,
    vfxSoundId,
    vfxSoundLeadMs,
    hurtSource,
    damageHalfWidth,
    damageHalfHeight,
    disappearAnimation,
    appearAnimation,
    targetOffsetY,
    appearElevated,
    comboNextAnimation,
    comboChancePct,
    comboOnly,
    lungeDistance,
    summonKinds,
    summonCount,
    summonMaxAlive,
  };
}

// check that an anim key string exists in this entity's animations map; throws with the available keys on miss
function requireAnimKeyExists(
  ctx: string,
  field: string,
  animKey: unknown,
  animations: Readonly<Record<string, AnimatedEntityAnimConfig>>,
): string {
  if (typeof animKey !== 'string' || animKey.length === 0) {
    throw new Error(
      `${ctx}.${field} must be a non-empty animation key string`,
    );
  }
  if (!(animKey in animations)) {
    throw new Error(
      `${ctx}.${field} references "${animKey}", which is not in animations. Available: [${Object.keys(animations).join(', ')}]`,
    );
  }
  return animKey;
}

// undefined when absent, otherwise the same existence-checked key as requireAnimKeyExists
function optionalAnimKey(
  ctx: string,
  field: string,
  animKey: unknown,
  animations: Readonly<Record<string, AnimatedEntityAnimConfig>>,
): string | undefined {
  if (animKey === undefined) return undefined;
  return requireAnimKeyExists(ctx, field, animKey, animations);
}

// validate one animation spec: file, frameWidth/Height/Count, loops (defaults true), optional anchor/scale
function validateAnim(
  identifier: string,
  animKey: string,
  raw: unknown,
): AnimatedEntityAnimConfig {
  const ctx = `entityRegistry["${identifier}"].animations["${animKey}"]`;
  const anim = v.requireObject(raw, ctx);
  return {
    file: v.requireString(anim, 'file', ctx),
    frameWidth: v.requirePositive(anim, 'frameWidth', ctx),
    frameHeight: v.requirePositive(anim, 'frameHeight', ctx),
    frameCount: v.requirePositive(anim, 'frameCount', ctx),
    loops: anim.loops !== false,
    anchorX: v.optionalFinite(anim, 'anchorX', ctx),
    anchorY: v.optionalFinite(anim, 'anchorY', ctx),
    spawnAnchorY: v.optionalFinite(anim, 'spawnAnchorY', ctx),
    displayScale: v.optionalFinite(anim, 'displayScale', ctx),
  };
}

// runs at module load; a bad entry throws and fails the whole boot loudly
const PARSED_ENTRIES: ReadonlyArray<ParsedEntry> = (() => {
  const raw = entityRegistryRaw as Record<string, unknown>;
  const out: ParsedEntry[] = [];
  for (const [identifier, value] of Object.entries(raw)) {
    out.push({ identifier, config: validateEntry(identifier, value) });
  }
  return out;
})();

// frozen identifier → config lookup table
const REGISTRY: EntityRegistry = Object.freeze(
  Object.fromEntries(PARSED_ENTRIES.map((e) => [e.identifier, e.config])),
);

// validated config for an identifier, or null if unknown
export function getEntityRegistryEntry(
  identifier: string,
): AnimatedEntityConfig | null {
  return REGISTRY[identifier] ?? null;
}

// behavior block for an identifier, or null if unknown or trap/passive
export function getEntityBehavior(
  identifier: string,
): AnimatedEntityBehaviorConfig | null {
  return REGISTRY[identifier]?.behavior ?? null;
}

// trap block for an identifier, or null if unknown or an enemy
export function getEntityTrap(
  identifier: string,
): AnimatedEntityTrapConfig | null {
  return REGISTRY[identifier]?.trap ?? null;
}

// all validated entries in registry-JSON order
export function listEntityRegistryEntries(): ReadonlyArray<ParsedEntry> {
  return PARSED_ENTRIES;
}

// full Phaser anim key for a given (identifier, animKey), namespaced to avoid player key collisions
export function entityAnimFullKey(
  identifier: string,
  animKey: string,
): string {
  return `${ENTITY_KEY_PREFIX}_${identifier}_${animKey}`;
}

// reverse map from full key to anim config, used by getSpriteAnchor
const ANIM_BY_FULL_KEY: ReadonlyMap<string, AnimatedEntityAnimConfig> = (() => {
  const map = new Map<string, AnimatedEntityAnimConfig>();
  for (const { identifier, config } of PARSED_ENTRIES) {
    for (const [animKey, anim] of Object.entries(config.animations)) {
      map.set(entityAnimFullKey(identifier, animKey), anim);
    }
  }
  return map;
})();

// anim config behind a full entity key, or undefined if none
export function getEntityAnimByFullKey(
  fullKey: string,
): AnimatedEntityAnimConfig | undefined {
  return ANIM_BY_FULL_KEY.get(fullKey);
}

// true when the full key is in the entity namespace (vs a player key)
export function isEntityAnimFullKey(fullKey: string): boolean {
  return fullKey.startsWith(`${ENTITY_KEY_PREFIX}_`);
}
