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

// Anim-key namespace for animated entities. Keeps entity animation keys
// disjoint from player keys (which use `{mode}_{anim}` like `sword_master_idle`)
// so the Phaser anim system can't accidentally resolve one as the other.
const ENTITY_KEY_PREFIX = 'entity';

interface ParsedEntry {
  readonly identifier: string;
  readonly config: AnimatedEntityConfig;
}

// Validates one registry entry. Throws with a clear message naming the
// offending identifier and field so authoring mistakes surface at boot
// rather than at first spawn (much later in the lifecycle).
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

const DROP_KINDS = [
  'gun1',
  'gun2',
  'magic',
  'coin',
  'heal',
  'key_storms',
  'key_widow',
] as const;

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

// Validates a behavior block: requires health, accepts optional hurtAnimation,
// deathAnimation, and an optional attack sub-block (validated separately).
// Errors include the identifier and the available animation list so authoring
// mistakes surface at boot rather than at first spawn — this is the primary
// defense against the registry/animation-key drift class of bugs.
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
    // Optional looping clip held while dormant. Unlike wakeAnimation it may
    // loop (it's the resting pose, not the one-shot wake), so no loops check.
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
  // Stealth/detection tuning — all optional, validated like the other
  // positive-number knobs. Defaults are applied at runtime (see Enemy /
  // constants), so absence just means "use the global default".
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
  // Patrol movement decoupled from attacks: lets an attack-less character
  // (spirit walkers) walk its loiterPath via the shared loiter code, which
  // falls back to these when attacks[0] supplies no walkAnimation/moveSpeed.
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
    // Frame must address a valid index of the death animation when one is
    // registered. When the entity has no death anim the runtime falls back
    // to firing on enterDeadState, so the frame is unused and we don't
    // enforce a bound (still required by the schema for authoring clarity).
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

  // Thin per-validator bindings over the shared primitives so the dozens of
  // call sites below stay one-argument.
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

  // Per-type field requirements. Building the result fields conditionally
  // keeps the runtime data lean — unused fields stay undefined rather than
  // null-filled, so the consumer code can rely on type-driven branches.
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

  // comboOnly is parsed up front because the melee/ranged/magic branch reads it
  // to relax the `range` requirement (a combo-only follow-up is never selected
  // independently, so it needs no selection range). The type restriction (combo
  // semantics only apply to melee/ranged/magic) is enforced below alongside
  // comboNextAnimation.
  comboOnly = v.optionalBoolean(a, 'comboOnly', ctx);

  // Hitbox parser shared by melee and teleport (both deliver damage via a
  // transient rect on a frame). Accepts either `hitbox` (single object) or
  // `hitboxes` (array of objects) and normalizes to an array so strategy
  // code can iterate uniformly. Multi-hitbox attacks let a single swing
  // damage several disjoint regions (e.g., a slam that strikes under the
  // body plus both sword tips) without authoring separate attack entries.
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
    // matchBody hitboxes stamp at the live body rect, so authored
    // width/height are unused — allow 0 to make "ignored" intent clear.
    // Other hitboxes still require positive dimensions (otherwise
    // overlapRect would be a no-op).
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
    // Per-hitbox `frame` (used to spread multi-strike attacks across the
    // swing) must reference a valid frame of the attack animation. Caught
    // here so a typo doesn't silently no-op at runtime.
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
    // Contact bumps damage on body overlap. No animation, no frame, no
    // range — the cooldown alone gates re-damage. Hitbox is implicit
    // (the body itself); the player's invuln window does the work of
    // preventing tick-storms from a wasp sticking to the player.
    damage = requirePositive('damage');
  } else if (type === 'aoe') {
    // AoE: wind-up animation with a damage-frame VFX spawn. Damage applies
    // when the VFX sprite overlaps the player (once per cast). The boss
    // animation and the VFX animation are separate clips — both must
    // exist in this entity's animations map and both must be one-shot
    // (looping would never fire the recover/cleanup paths).
    animation = requireAnimKeyExists(ctx, 'animation', a.animation, animations);
    // Either single-fire (`frame`) or multi-fire (`damageFrames`) — caught
    // here so animation/damage configuration mistakes surface at boot.
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
      // Normalize to ascending order so onAnimUpdate's "earliest unfired" walk
      // is simply array order.
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
    // Dive: animated lunge that commits a body-velocity at entry to
    // reach the player by the end of the animation. Damage applies on
    // body-overlap during the dive (no transient hitbox, no per-frame
    // damage gate). minRange is optional — keeps the crow from diving
    // when already adjacent (would look like a stutter).
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
    // Teleport: two- or three-phase wind-up + (appear) + strike.
    // disappearAnimation plays at the pre-teleport position; `animation` is
    // the strike clip played at the destination, and its `frame` is the
    // damage frame. When `appearAnimation` is set, it plays as a visual-only
    // reappear clip between the disappear and the strike. All clips must be
    // one-shot — looping would trap the entity in 'attack' state.
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
    // Summon: plays a one-shot cast animation; on `frame` it spawns minions
    // beside the caster. Deals no damage. `range` gates selection so the caster
    // only summons once the player is engaged. summonKinds existence in the
    // registry is checked at runtime (respawn returns null for an unknown /
    // behavior-less id, which fireSummonAttack skips) — same deferral the
    // comboNextAnimation cross-reference uses, since the full registry isn't
    // built yet at validation time.
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
    // A combo-only follow-up is never selected independently, so it needs no
    // selection range; reachability is inherited from the lead attack's range
    // check at combo time. Every other melee/ranged/magic attack requires one.
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

  // requireGroundedTarget is an opt-in AoE-only modifier. Reject it on other
  // types so a typo (e.g. set on a melee swing) fails loudly at boot rather
  // than silently doing nothing at runtime.
  // AoE-only modifiers. Each rejects on other types so a typo (e.g. set on a
  // melee swing) fails loudly at boot rather than silently doing nothing.
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

  // Combo chaining is only meaningful for attacks that complete via the
  // standard animation-complete → recover path. teleport/dive/aoe/contact
  // have non-standard completion (phase machines, overlap-driven damage, no
  // swing) — reject the field on them so a misplaced combo fails loudly at
  // boot rather than silently no-opping.
  if (a.comboNextAnimation !== undefined) {
    if (type !== 'melee' && type !== 'ranged' && type !== 'magic') {
      throw new Error(
        `${ctx}.comboNextAnimation is only valid on type "melee" | "ranged" | "magic" (got type "${type}")`,
      );
    }
    // Validate the key exists in this entity's animations. Cross-checking that
    // it names another *attack* in the same pool isn't possible here (we see
    // one entry at a time); that lookup no-ops safely at runtime if unmatched.
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

  // comboOnly shares the combo type restriction: chaining only runs on the
  // animation-complete → recover path that melee/ranged/magic use. Reject it
  // elsewhere so a misplaced flag fails loudly at boot.
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

  // Summon fields are summon-only — reject on other types so a typo (e.g.
  // summonKinds on a melee swing) fails at boot rather than silently no-opping.
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

// Shared helpers for animation-key validation. Hoisted out of validateBehavior/
// validateAttack so both can throw consistent errors that name the offending
// field with its full ctx path and list the available keys.
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

function optionalAnimKey(
  ctx: string,
  field: string,
  animKey: unknown,
  animations: Readonly<Record<string, AnimatedEntityAnimConfig>>,
): string | undefined {
  if (animKey === undefined) return undefined;
  return requireAnimKeyExists(ctx, field, animKey, animations);
}

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

const PARSED_ENTRIES: ReadonlyArray<ParsedEntry> = (() => {
  const raw = entityRegistryRaw as Record<string, unknown>;
  const out: ParsedEntry[] = [];
  for (const [identifier, value] of Object.entries(raw)) {
    out.push({ identifier, config: validateEntry(identifier, value) });
  }
  return out;
})();

const REGISTRY: EntityRegistry = Object.freeze(
  Object.fromEntries(PARSED_ENTRIES.map((e) => [e.identifier, e.config])),
);

export function getEntityRegistryEntry(
  identifier: string,
): AnimatedEntityConfig | null {
  return REGISTRY[identifier] ?? null;
}

export function getEntityBehavior(
  identifier: string,
): AnimatedEntityBehaviorConfig | null {
  return REGISTRY[identifier]?.behavior ?? null;
}

export function getEntityTrap(
  identifier: string,
): AnimatedEntityTrapConfig | null {
  return REGISTRY[identifier]?.trap ?? null;
}

export function listEntityRegistryEntries(): ReadonlyArray<ParsedEntry> {
  return PARSED_ENTRIES;
}

// Phaser texture and animation key for a given (identifier, animKey).
// Namespaced under `entity_` so it cannot collide with player keys.
export function entityAnimFullKey(
  identifier: string,
  animKey: string,
): string {
  return `${ENTITY_KEY_PREFIX}_${identifier}_${animKey}`;
}

// Lookup the registry anim config behind a full key. Used by getSpriteAnchor
// to resolve entity anims uniformly alongside player anims.
const ANIM_BY_FULL_KEY: ReadonlyMap<string, AnimatedEntityAnimConfig> = (() => {
  const map = new Map<string, AnimatedEntityAnimConfig>();
  for (const { identifier, config } of PARSED_ENTRIES) {
    for (const [animKey, anim] of Object.entries(config.animations)) {
      map.set(entityAnimFullKey(identifier, animKey), anim);
    }
  }
  return map;
})();

export function getEntityAnimByFullKey(
  fullKey: string,
): AnimatedEntityAnimConfig | undefined {
  return ANIM_BY_FULL_KEY.get(fullKey);
}

export function isEntityAnimFullKey(fullKey: string): boolean {
  return fullKey.startsWith(`${ENTITY_KEY_PREFIX}_`);
}
