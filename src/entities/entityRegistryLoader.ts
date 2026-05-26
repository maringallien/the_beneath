import entityRegistryRaw from './entityRegistry.json';
import type {
  AnimatedEntityAnimConfig,
  AnimatedEntityAttackConfig,
  AnimatedEntityBehaviorConfig,
  AnimatedEntityConfig,
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
  if (raw == null || typeof raw !== 'object') {
    throw new Error(
      `entityRegistry["${identifier}"] is not an object`,
    );
  }
  const entry = raw as Record<string, unknown>;
  const defaultAnimation = entry.defaultAnimation;
  if (typeof defaultAnimation !== 'string' || defaultAnimation.length === 0) {
    throw new Error(
      `entityRegistry["${identifier}"].defaultAnimation must be a non-empty string`,
    );
  }
  const physicsBodyRaw = entry.physicsBody;
  if (physicsBodyRaw == null || typeof physicsBodyRaw !== 'object') {
    throw new Error(
      `entityRegistry["${identifier}"].physicsBody must be an object with width/height`,
    );
  }
  const physicsBody = physicsBodyRaw as Record<string, unknown>;
  if (
    typeof physicsBody.width !== 'number' ||
    typeof physicsBody.height !== 'number'
  ) {
    throw new Error(
      `entityRegistry["${identifier}"].physicsBody.width/height must be numbers`,
    );
  }
  const animationsRaw = entry.animations;
  if (animationsRaw == null || typeof animationsRaw !== 'object') {
    throw new Error(
      `entityRegistry["${identifier}"].animations must be an object`,
    );
  }
  const animations: Record<string, AnimatedEntityAnimConfig> = {};
  for (const [animKey, animRaw] of Object.entries(animationsRaw)) {
    animations[animKey] = validateAnim(identifier, animKey, animRaw);
  }
  if (!(defaultAnimation in animations)) {
    throw new Error(
      `entityRegistry["${identifier}"].defaultAnimation "${defaultAnimation}" not present in animations`,
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
      `entityRegistry["${identifier}"] has both behavior and trap blocks — pick one. ` +
        'Enemies (with health/AI) use behavior; passive damage sources use trap.',
    );
  }
  return {
    defaultAnimation,
    physicsBody: {
      width: physicsBody.width,
      height: physicsBody.height,
    },
    gravity: entry.gravity === true,
    animations,
    behavior,
    trap,
  };
}

function validateTrap(
  identifier: string,
  raw: unknown,
): AnimatedEntityTrapConfig {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(
      `entityRegistry["${identifier}"].trap must be an object when set`,
    );
  }
  const t = raw as Record<string, unknown>;
  const damage = t.damage;
  if (typeof damage !== 'number' || !Number.isFinite(damage) || damage <= 0) {
    throw new Error(
      `entityRegistry["${identifier}"].trap.damage must be a positive number (got ${JSON.stringify(damage)})`,
    );
  }
  let directContactAnimation: string | undefined;
  if (t.directContactAnimation !== undefined) {
    if (typeof t.directContactAnimation !== 'string' || t.directContactAnimation.length === 0) {
      throw new Error(
        `entityRegistry["${identifier}"].trap.directContactAnimation must be a non-empty animation key when set`,
      );
    }
    directContactAnimation = t.directContactAnimation;
  }
  let damageZone: AnimatedEntityTrapConfig['damageZone'];
  if (t.damageZone !== undefined) {
    if (t.damageZone === null || typeof t.damageZone !== 'object') {
      throw new Error(
        `entityRegistry["${identifier}"].trap.damageZone must be an object when set`,
      );
    }
    const z = t.damageZone as Record<string, unknown>;
    const requireZoneNum = (field: string, allowNonPositive = false): number => {
      const value = z[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `entityRegistry["${identifier}"].trap.damageZone.${field} must be a finite number`,
        );
      }
      if (!allowNonPositive && value <= 0) {
        throw new Error(
          `entityRegistry["${identifier}"].trap.damageZone.${field} must be positive`,
        );
      }
      return value;
    };
    damageZone = {
      width: requireZoneNum('width'),
      height: requireZoneNum('height'),
      offsetX: requireZoneNum('offsetX', true),
      offsetY: requireZoneNum('offsetY', true),
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

  const healthRaw = b.health;
  if (
    typeof healthRaw !== 'number' ||
    !Number.isFinite(healthRaw) ||
    healthRaw <= 0
  ) {
    throw new Error(
      `${ctx}.health must be a positive number (got ${JSON.stringify(healthRaw)})`,
    );
  }
  const health = healthRaw;

  const hurtAnimation = optionalAnimKey(
    ctx,
    'hurtAnimation',
    b.hurtAnimation,
    animations,
  );
  let hurtSoundId: string | undefined;
  if (b.hurtSoundId !== undefined) {
    if (typeof b.hurtSoundId !== 'string' || b.hurtSoundId.length === 0) {
      throw new Error(
        `${ctx}.hurtSoundId must be a non-empty string when set (got ${JSON.stringify(b.hurtSoundId)})`,
      );
    }
    hurtSoundId = b.hurtSoundId;
  }
  let encounterSoundId: string | undefined;
  if (b.encounterSoundId !== undefined) {
    if (
      typeof b.encounterSoundId !== 'string' ||
      b.encounterSoundId.length === 0
    ) {
      throw new Error(
        `${ctx}.encounterSoundId must be a non-empty string when set (got ${JSON.stringify(b.encounterSoundId)})`,
      );
    }
    encounterSoundId = b.encounterSoundId;
  }
  let encounterRadius: number | undefined;
  if (b.encounterRadius !== undefined) {
    if (
      typeof b.encounterRadius !== 'number' ||
      !Number.isFinite(b.encounterRadius) ||
      b.encounterRadius <= 0
    ) {
      throw new Error(
        `${ctx}.encounterRadius must be a positive number when set (got ${JSON.stringify(b.encounterRadius)})`,
      );
    }
    encounterRadius = b.encounterRadius;
  }
  let engageDelayMs: number | undefined;
  if (b.engageDelayMs !== undefined) {
    if (
      typeof b.engageDelayMs !== 'number' ||
      !Number.isFinite(b.engageDelayMs) ||
      b.engageDelayMs < 0
    ) {
      throw new Error(
        `${ctx}.engageDelayMs must be a non-negative number when set (got ${JSON.stringify(b.engageDelayMs)})`,
      );
    }
    engageDelayMs = b.engageDelayMs;
  }
  if (
    encounterRadius !== undefined &&
    encounterSoundId === undefined &&
    engageDelayMs === undefined
  ) {
    throw new Error(
      `${ctx}.encounterRadius is set but neither encounterSoundId nor engageDelayMs is — the radius has nothing to trigger.`,
    );
  }
  const deathAnimation = optionalAnimKey(
    ctx,
    'deathAnimation',
    b.deathAnimation,
    animations,
  );
  let immovable: boolean | undefined;
  if (b.immovable !== undefined) {
    if (typeof b.immovable !== 'boolean') {
      throw new Error(`${ctx}.immovable must be a boolean when set`);
    }
    immovable = b.immovable;
  }
  let horizontalMovementOnly: boolean | undefined;
  if (b.horizontalMovementOnly !== undefined) {
    if (typeof b.horizontalMovementOnly !== 'boolean') {
      throw new Error(
        `${ctx}.horizontalMovementOnly must be a boolean when set`,
      );
    }
    horizontalMovementOnly = b.horizontalMovementOnly;
  }
  let stayInSpawnLevel: boolean | undefined;
  if (b.stayInSpawnLevel !== undefined) {
    if (typeof b.stayInSpawnLevel !== 'boolean') {
      throw new Error(`${ctx}.stayInSpawnLevel must be a boolean when set`);
    }
    stayInSpawnLevel = b.stayInSpawnLevel;
  }
  let hideHealthBar: boolean | undefined;
  if (b.hideHealthBar !== undefined) {
    if (typeof b.hideHealthBar !== 'boolean') {
      throw new Error(`${ctx}.hideHealthBar must be a boolean when set`);
    }
    hideHealthBar = b.hideHealthBar;
  }
  let healthBarOffsetY: number | undefined;
  if (b.healthBarOffsetY !== undefined) {
    if (
      typeof b.healthBarOffsetY !== 'number' ||
      !Number.isFinite(b.healthBarOffsetY)
    ) {
      throw new Error(
        `${ctx}.healthBarOffsetY must be a finite number when set (got ${JSON.stringify(b.healthBarOffsetY)})`,
      );
    }
    healthBarOffsetY = b.healthBarOffsetY;
  }
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
    const requirePositive = (field: string): number => {
      const value = d[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${dctx}.${field} must be a positive number`);
      }
      return value;
    };
    dodgeOnProjectile = {
      triggerRangePx: requirePositive('triggerRangePx'),
      cooldownMs: requirePositive('cooldownMs'),
    };
  }

  return {
    health,
    hurtAnimation,
    hurtSoundId,
    encounterSoundId,
    encounterRadius,
    engageDelayMs,
    deathAnimation,
    immovable,
    horizontalMovementOnly,
    stayInSpawnLevel,
    hideHealthBar,
    healthBarOffsetY,
    attack,
    attackPool,
    dodgeOnProjectile,
  };
}

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

  const type = a.type;
  if (
    type !== 'melee' &&
    type !== 'ranged' &&
    type !== 'magic' &&
    type !== 'contact' &&
    type !== 'heal' &&
    type !== 'dive' &&
    type !== 'aoe' &&
    type !== 'teleport'
  ) {
    throw new Error(
      `${ctx}.type must be "melee" | "ranged" | "magic" | "contact" | "heal" | "dive" | "aoe" | "teleport" (got ${JSON.stringify(type)})`,
    );
  }

  const requirePositive = (field: string): number => {
    const value = a[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `${ctx}.${field} must be a positive number (got ${JSON.stringify(value)})`,
      );
    }
    return value;
  };
  const requireNonNegativeInt = (field: string): number => {
    const value = a[field];
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      throw new Error(
        `${ctx}.${field} must be a non-negative integer (got ${JSON.stringify(value)})`,
      );
    }
    return value;
  };
  const optionalPositive = (field: string): number | undefined => {
    const value = a[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `${ctx}.${field} must be a positive number when set (got ${JSON.stringify(value)})`,
      );
    }
    return value;
  };
  const optionalFraction = (field: string): number | undefined => {
    const value = a[field];
    if (value === undefined) return undefined;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value >= 1
    ) {
      throw new Error(
        `${ctx}.${field} must be a number in (0, 1) exclusive when set (got ${JSON.stringify(value)})`,
      );
    }
    return value;
  };

  const cooldownMs = requirePositive('cooldownMs');
  const recastCooldownMs = optionalPositive('recastCooldownMs');
  const weight = optionalPositive('weight');
  if (typeof a.aggressive !== 'boolean') {
    throw new Error(`${ctx}.aggressive must be a boolean`);
  }
  const aggressive = a.aggressive;

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
    const requireHitboxNum = (field: string): number => {
      const value = hb[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `${ctx}.${label}.${field} must be a number (got ${JSON.stringify(value)})`,
        );
      }
      return value;
    };
    let matchBody: boolean | undefined;
    if (hb.matchBody !== undefined) {
      if (typeof hb.matchBody !== 'boolean') {
        throw new Error(
          `${ctx}.${label}.matchBody must be a boolean when set (got ${JSON.stringify(hb.matchBody)})`,
        );
      }
      matchBody = hb.matchBody;
    }
    const hbWidth = requireHitboxNum('width');
    const hbHeight = requireHitboxNum('height');
    // matchBody hitboxes stamp at the live body rect, so authored
    // width/height are unused — allow 0 to make "ignored" intent clear.
    // Other hitboxes still require positive dimensions (otherwise
    // overlapRect would be a no-op).
    if (!matchBody && (hbWidth <= 0 || hbHeight <= 0)) {
      throw new Error(
        `${ctx}.${label}.width and height must be > 0 (got ${hbWidth}x${hbHeight})`,
      );
    }
    let hbFrame: number | undefined;
    if (hb.frame !== undefined) {
      const f = hb.frame;
      if (typeof f !== 'number' || !Number.isInteger(f) || f < 0) {
        throw new Error(
          `${ctx}.${label}.frame must be a non-negative integer when set (got ${JSON.stringify(f)})`,
        );
      }
      hbFrame = f;
    }
    return {
      offsetX: requireHitboxNum('offsetX'),
      offsetY: requireHitboxNum('offsetY'),
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
    if (a.targetOffsetY !== undefined) {
      if (typeof a.targetOffsetY !== 'number' || !Number.isFinite(a.targetOffsetY)) {
        throw new Error(
          `${ctx}.targetOffsetY must be a finite number when set (got ${JSON.stringify(a.targetOffsetY)})`,
        );
      }
      targetOffsetY = a.targetOffsetY;
    }
    if (a.appearElevated !== undefined) {
      if (typeof a.appearElevated !== 'boolean') {
        throw new Error(
          `${ctx}.appearElevated must be a boolean when set (got ${JSON.stringify(a.appearElevated)})`,
        );
      }
      if (a.appearElevated === true && appearAnimation === undefined) {
        throw new Error(
          `${ctx}.appearElevated:true requires appearAnimation to be set — the elevation is only meaningful for three-phase teleports`,
        );
      }
      appearElevated = a.appearElevated;
    }
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
    range = requirePositive('range');
    minRange = optionalPositive('minRange');
    if (minRange !== undefined && minRange >= range) {
      throw new Error(
        `${ctx}.minRange (${minRange}) must be less than range (${range})`,
      );
    }

    if (type === 'melee') {
      hitboxes = parseHitbox();
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
      const requireFiniteNumber = (field: string): number | undefined => {
        const value = a[field];
        if (value === undefined) return undefined;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(
            `${ctx}.${field} must be a finite number when set (got ${JSON.stringify(value)})`,
          );
        }
        return value;
      };
      projectileOriginX = requireFiniteNumber('projectileOriginX');
      projectileOriginY = requireFiniteNumber('projectileOriginY');
    }
  }

  if (
    type !== 'ranged' &&
    type !== 'magic' &&
    (a.projectileOriginX !== undefined || a.projectileOriginY !== undefined)
  ) {
    throw new Error(
      `${ctx}.projectileOriginX/Y are only valid on type "ranged" or "magic" (got type "${type}")`,
    );
  }

  // requireGroundedTarget is an opt-in AoE-only modifier. Reject it on other
  // types so a typo (e.g. set on a melee swing) fails loudly at boot rather
  // than silently doing nothing at runtime.
  if (a.requireGroundedTarget !== undefined) {
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.requireGroundedTarget is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (typeof a.requireGroundedTarget !== 'boolean') {
      throw new Error(
        `${ctx}.requireGroundedTarget must be a boolean when set (got ${JSON.stringify(a.requireGroundedTarget)})`,
      );
    }
    requireGroundedTarget = a.requireGroundedTarget;
  }

  if (a.minAirborneDodgeClearancePx !== undefined) {
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.minAirborneDodgeClearancePx is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (
      typeof a.minAirborneDodgeClearancePx !== 'number' ||
      !Number.isFinite(a.minAirborneDodgeClearancePx) ||
      a.minAirborneDodgeClearancePx <= 0
    ) {
      throw new Error(
        `${ctx}.minAirborneDodgeClearancePx must be a positive finite number when set (got ${JSON.stringify(a.minAirborneDodgeClearancePx)})`,
      );
    }
    if (a.requireGroundedTarget !== true) {
      throw new Error(
        `${ctx}.minAirborneDodgeClearancePx requires requireGroundedTarget=true to take effect`,
      );
    }
    minAirborneDodgeClearancePx = a.minAirborneDodgeClearancePx;
  }

  if (a.requireOpenSky !== undefined) {
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.requireOpenSky is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (typeof a.requireOpenSky !== 'boolean') {
      throw new Error(
        `${ctx}.requireOpenSky must be a boolean when set (got ${JSON.stringify(a.requireOpenSky)})`,
      );
    }
    requireOpenSky = a.requireOpenSky;
  }

  if (a.groundProjectVfx !== undefined) {
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.groundProjectVfx is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (typeof a.groundProjectVfx !== 'boolean') {
      throw new Error(
        `${ctx}.groundProjectVfx must be a boolean when set (got ${JSON.stringify(a.groundProjectVfx)})`,
      );
    }
    if (a.requireGroundedTarget === true && a.groundProjectVfx === true) {
      throw new Error(
        `${ctx} cannot set both requireGroundedTarget and groundProjectVfx — they describe opposite mid-air behaviors (suppress vs reproject)`,
      );
    }
    groundProjectVfx = a.groundProjectVfx;
  }

  if (a.vfxDelayMs !== undefined) {
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.vfxDelayMs is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (
      typeof a.vfxDelayMs !== 'number' ||
      !Number.isFinite(a.vfxDelayMs) ||
      a.vfxDelayMs < 0
    ) {
      throw new Error(
        `${ctx}.vfxDelayMs must be a non-negative finite number when set (got ${JSON.stringify(a.vfxDelayMs)})`,
      );
    }
    vfxDelayMs = a.vfxDelayMs;
  }

  if (a.vfxSoundId !== undefined) {
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.vfxSoundId is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (typeof a.vfxSoundId !== 'string' || a.vfxSoundId.length === 0) {
      throw new Error(
        `${ctx}.vfxSoundId must be a non-empty string when set (got ${JSON.stringify(a.vfxSoundId)})`,
      );
    }
    vfxSoundId = a.vfxSoundId;
  }

  if (a.vfxSoundLeadMs !== undefined) {
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.vfxSoundLeadMs is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (
      typeof a.vfxSoundLeadMs !== 'number' ||
      !Number.isFinite(a.vfxSoundLeadMs) ||
      a.vfxSoundLeadMs < 0
    ) {
      throw new Error(
        `${ctx}.vfxSoundLeadMs must be a non-negative finite number when set (got ${JSON.stringify(a.vfxSoundLeadMs)})`,
      );
    }
    if (a.vfxSoundId === undefined) {
      throw new Error(
        `${ctx}.vfxSoundLeadMs requires vfxSoundId to also be set`,
      );
    }
    vfxSoundLeadMs = a.vfxSoundLeadMs;
  }

  if (a.hurtSource !== undefined) {
    if (type !== 'aoe') {
      throw new Error(
        `${ctx}.hurtSource is only valid on type "aoe" (got type "${type}")`,
      );
    }
    if (a.hurtSource !== 'melee' && a.hurtSource !== 'projectile') {
      throw new Error(
        `${ctx}.hurtSource must be "melee" or "projectile" when set (got ${JSON.stringify(a.hurtSource)})`,
      );
    }
    hurtSource = a.hurtSource;
  }

  let damageHalfWidth: number | undefined;
  let damageHalfHeight: number | undefined;
  const validateAoeHalfDim = (field: 'damageHalfWidth' | 'damageHalfHeight'): number | undefined => {
    const value = a[field];
    if (value === undefined) return undefined;
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
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `${ctx}.${field} must be a positive finite number (got ${JSON.stringify(value)})`,
      );
    }
    return value;
  };
  damageHalfWidth = validateAoeHalfDim('damageHalfWidth');
  damageHalfHeight = validateAoeHalfDim('damageHalfHeight');

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
  if (raw == null || typeof raw !== 'object') {
    throw new Error(
      `entityRegistry["${identifier}"].animations["${animKey}"] is not an object`,
    );
  }
  const anim = raw as Record<string, unknown>;
  const requireNum = (field: string): number => {
    const value = anim[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `entityRegistry["${identifier}"].animations["${animKey}"].${field} must be a positive number`,
      );
    }
    return value;
  };
  const file = anim.file;
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error(
      `entityRegistry["${identifier}"].animations["${animKey}"].file must be a non-empty string`,
    );
  }
  const optionalNum = (field: string): number | undefined => {
    const value = anim[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `entityRegistry["${identifier}"].animations["${animKey}"].${field} must be a number when set`,
      );
    }
    return value;
  };
  return {
    file,
    frameWidth: requireNum('frameWidth'),
    frameHeight: requireNum('frameHeight'),
    frameCount: requireNum('frameCount'),
    loops: anim.loops !== false,
    anchorX: optionalNum('anchorX'),
    anchorY: optionalNum('anchorY'),
    spawnAnchorY: optionalNum('spawnAnchorY'),
    displayScale: optionalNum('displayScale'),
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
