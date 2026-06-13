/**
 * entityRegistryTypes — the type model for the JSON-authored animated-entity registry.
 *
 * Each LDtk identifier (e.g. "Caged_spider_spawn") maps to one AnimatedEntityConfig
 * describing where its sprites live, how to slice the sheets into frames, and the
 * optional behavior/trap/drop blocks that decide what the entity becomes. The
 * registry is the single source of truth that turns "this LDtk identifier should
 * animate" into a runnable Phaser sprite — a new entity type is one JSON entry, not
 * a factory function. The companion validator (entityRegistryLoader) enforces every
 * constraint noted on these members at boot — chiefly that all animation-key fields
 * reference keys within the same entry's `animations` map — so authoring mistakes
 * surface at load time rather than at first spawn; the EntityFactory keys off block
 * presence (behavior → Enemy, trap → Trap, neither → plain AnimatedEntity).
 *
 * Inputs:  none — pure compile-time type/interface/union declarations.
 * Outputs: the registry config shapes below, consumed by the loader and the entities.
 * @calledby the registry loader/validator and the entity classes that read configs.
 * @calls    nothing — a leaf types module.
 */

export interface AnimatedEntityAnimConfig {
  // Path to the spritesheet PNG, relative to /public.
  readonly file: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  // Default true; set false for one-shot clips like death.
  readonly loops?: boolean;
  // Frame-px column of the body's horizontal anchor (default: frameWidth/2).
  readonly anchorX?: number;
  // Frame-px row of the body's bottom edge (default: frameHeight).
  readonly anchorY?: number;
  // Frame-px row to align with the LDtk pivot at spawn — for bosses whose figure sits low in an oversized frame.
  readonly spawnAnchorY?: number;
  // Visual-only render scale; default 1.
  readonly displayScale?: number;
}

export interface AnimatedEntityPhysicsBodyConfig {
  readonly width: number;
  readonly height: number;
}

// Transient melee hitbox rect; fires at most once per attack cycle.
export interface AnimatedEntityHitboxConfig {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  // Per-hitbox frame override so one swing can stamp rects at different frames.
  readonly frame?: number;
  // When true, ignores offset/size and stamps the rect at the live body bounds (for body-slam attacks).
  readonly matchBody?: boolean;
}

// Per-attack config; all animation-key fields must reference a key in the entity's own `animations` map.
export interface AnimatedEntityAttackConfig {
  // Attack kind:
  //   melee/ranged/magic — hitbox or projectile on the damage frame.
  //   contact — damage on body overlap (no swing anim).
  //   heal    — self-cast; AI picks only when HP < healThreshold.
  //   dive    — straight-line lunge; damages on overlap throughout.
  //   aoe     — wind-up then VFX at the player's snapshot position; vfxDelayMs is the dodge window.
  //   teleport — disappear, reposition to player ground, strike; 2- or 3-phase depending on appearAnimation.
  //   summon  — spawns minions beside the caster on the cast frame.
  readonly type:
    | 'melee'
    | 'ranged'
    | 'magic'
    | 'contact'
    | 'heal'
    | 'dive'
    | 'aoe'
    | 'teleport'
    | 'summon';
  // Animation key; optional for contact (no swing anim).
  readonly animation?: string;
  // 0-based damage/projectile/heal frame. For AoE: use `frame` or `damageFrames`, not both.
  readonly frame?: number;
  // 'aoe'-only: multiple damage frames, each re-snapshotting the player. Mutually exclusive with `frame`.
  readonly damageFrames?: ReadonlyArray<number>;
  readonly damage?: number;
  // HP restored on heal-type. Required when type === 'heal'.
  readonly heal?: number;
  // HP fraction below which heal becomes eligible; default 0.5.
  readonly healThreshold?: number;
  // Max distance to initiate; required for melee/ranged/magic/dive.
  readonly range?: number;
  // Min distance below which the attack won't fire (prevents point-blank dives).
  readonly minRange?: number;
  readonly cooldownMs: number;
  // Per-attack cooldown independent of the shared recover window — useful for a heavy attack on its own timer.
  readonly recastCooldownMs?: number;
  // Relative pick weight among eligible attackPool entries; default 1.
  readonly weight?: number;
  // On anim complete, roll comboChancePct to chain immediately into this animation key's pool entry.
  readonly comboNextAnimation?: string;
  // Probability (0–100) of chaining into comboNextAnimation.
  readonly comboChancePct?: number;
  // When true, AI never selects this attack directly — only as a combo follow-up.
  readonly comboOnly?: boolean;
  // Melee-only: body advance distance (px) on swing completion to match the art's baked-in lunge.
  readonly lungeDistance?: number;
  readonly aggressive: boolean;
  // Chase distance; absent = stationary attacker.
  readonly chaseRange?: number;
  readonly moveSpeed?: number;
  readonly walkAnimation?: string;
  // Hitbox(es) stamped on the damage frame; validator normalizes single `hitbox` and `hitboxes` to this array.
  readonly hitboxes?: ReadonlyArray<AnimatedEntityHitboxConfig>;
  readonly projectileAnimIdle?: string;
  readonly projectileAnimExplode?: string;
  readonly projectileSpeed?: number;
  // Spawn offset (world px) from sprite center; X mirrors with facing.
  readonly projectileOriginX?: number;
  readonly projectileOriginY?: number;
  // When true, fires horizontally at fixed elevation instead of homing on the player.
  readonly projectileStraight?: boolean;
  // projectileStraight only: won't fire unless muzzle Y is within this margin of the player's body.
  readonly verticalAlignMarginPx?: number;
  // 'summon'-only: registry ids to pick from; each must be a behavior-bearing entry.
  readonly summonKinds?: ReadonlyArray<string>;
  // 'summon'-only: minions spawned per cast.
  readonly summonCount?: number;
  // 'summon'-only: cap on this caster's live minions; omit for no cap.
  readonly summonMaxAlive?: number;
  // 'aoe'-only: one-shot VFX animation at the snapshot. Omit for sprite-less damage rect.
  readonly vfxAnimation?: string;
  // 'aoe'-only: suppress damage when player isn't grounded (jump to dodge).
  readonly requireGroundedTarget?: boolean;
  // 'aoe'-only: minimum clearance (px) below player for the "airborne" dodge to apply.
  readonly minAirborneDodgeClearancePx?: number;
  // 'aoe'-only: drops VFX to the nearest solid tile below the snapshot so a ground strike always lands on the floor.
  readonly groundProjectVfx?: boolean;
  // 'aoe'-only: suppress when a solid tile is directly above the player (sheltered from arrow rain).
  readonly requireOpenSky?: boolean;
  // 'aoe'-only: ms between damage-frame trigger and VFX spawn — the dodge window for arrow-volleys.
  readonly vfxDelayMs?: number;
  // 'aoe'-only: sound played at VFX spawn (or vfxSoundLeadMs early to align a front-loaded clip).
  readonly vfxSoundId?: string;
  // 'aoe'-only: ms before VFX spawn to start vfxSoundId.
  readonly vfxSoundLeadMs?: number;
  // 'aoe'-only: hurt-sound variant — 'projectile' for arrow-rain, 'melee' for ground strikes.
  readonly hurtSource?: 'melee' | 'projectile';
  // 'aoe'-only (sprite-less): half-width (px) of the damage rect; default 24.
  readonly damageHalfWidth?: number;
  // 'aoe'-only (sprite-less): half-height (px) of the damage rect anchored at body.bottom; default 32.
  readonly damageHalfHeight?: number;
  // 'teleport'-only: one-shot wind-up clip at the pre-teleport position.
  readonly disappearAnimation?: string;
  // 'teleport'-only: optional reappear clip inserted before the strike, making it three-phase.
  readonly appearAnimation?: string;
  // 'teleport'-only: vertical offset (px) from the ground at the appear destination; default -80.
  readonly targetOffsetY?: number;
  // 'teleport'-only, three-phase: appear clip starts one body-height elevated above the strike target.
  readonly appearElevated?: boolean;
}

// Combat parameters; presence signals the EntityFactory to spawn Enemy instead of AnimatedEntity.
export interface AnimatedEntityBehaviorConfig {
  readonly health: number;
  // Optional hurt animation; entities without one just flicker via i-frames.
  readonly hurtAnimation?: string;
  // Sound on non-lethal hit; suppressed on the killing blow.
  readonly hurtSoundId?: string;
  // Boss-encounter stinger; plays once per instance when the player enters encounterRadius.
  readonly encounterSoundId?: string;
  // Distance that triggers encounterSoundId/engageDelayMs; default 300 px.
  readonly encounterRadius?: number;
  // Entity is dormant until it has line of sight within `range` px, then plays wakeAnimation once.
  readonly dormant?: {
    readonly wakeAnimation: string;
    readonly trigger: 'lineOfSight';
    readonly range?: number;
    // Looping clip while asleep; default: first frame of wakeAnimation paused.
    readonly sleepAnimation?: string;
  };
  // How long (ms) the boss idles after the encounter trigger before it starts fighting.
  readonly engageDelayMs?: number;
  // Death animation key; defaults to 'death' if that key exists.
  readonly deathAnimation?: string;
  // Entity ignores knockback and is physics-immovable; use for fixed set-pieces.
  readonly immovable?: boolean;
  // Movement drives X only (Y forced to 0); for gravity-off bosses that glide horizontally.
  readonly horizontalMovementOnly?: boolean;
  // Clamps body and teleport destinations inside the spawn level rect (arena-bound bosses).
  readonly stayInSpawnLevel?: boolean;
  // Chase leash radius around home anchor; entity breaks off beyond this and drifts back.
  readonly homeLeashRange?: number;
  // When true, the entity never respawns after death.
  readonly isBoss?: boolean;
  // Enables the 3-round fight system (segmented bar, round banners, invuln breaks).
  readonly roundFight?: boolean;
  // Name shown on the round-fight bar; derived from the identifier if omitted.
  readonly displayName?: string;
  // Patrol movement when no attack supplies walk fields; ignored if attacks[0] has them.
  readonly walkAnimation?: string;
  readonly moveSpeed?: number;
  // Single attack shorthand; attackPool wins if both are set.
  readonly attack?: AnimatedEntityAttackConfig;
  // Multi-attack pool; the AI picks an eligible entry each cycle.
  readonly attackPool?: ReadonlyArray<AnimatedEntityAttackConfig>;
  // Suppress the floating HP bar for swarm minions or set-pieces.
  readonly hideHealthBar?: boolean;
  // Vertical nudge (source px) for the floating HP bar; positive = higher.
  readonly healthBarOffsetY?: number;
  // ── Stealth / detection tuning (optional; defaults live in constants) ──────
  // Sight range override; defaults to chaseRange or ENEMY_DETECTION_RANGE_PX.
  readonly detectionRange?: number;
  // Vision cone half-angle (degrees); defaults to ENEMY_VISION_HALF_ANGLE_DEG.
  readonly visionHalfAngleDeg?: number;
  // Chase-speed multiplier after detection; defaults to ENEMY_ALERT_SPEED_MUL.
  readonly alertSpeedMul?: number;
  // Opts out of stealth entirely — always-on aggro, no vision cone or HUD dot.
  readonly ignoresStealth?: boolean;
  // Teleport-dodge reaction when a projectile enters triggerRangePx.
  readonly dodgeOnProjectile?: {
    readonly triggerRangePx: number;
    // Min ms between projectile-triggered teleports.
    readonly cooldownMs: number;
  };
  // Circular damage burst on the death-animation frame — hits player and other enemies.
  readonly deathExplosion?: {
    readonly damage: number;
    readonly radius: number;
    // 0-based death-anim frame when the burst fires.
    readonly frame: number;
  };
  // Spawn-anchored wander config; omit to use the default radius.
  readonly wander?: AnimatedEntityWanderConfig;
  // Holds idle out of combat instead of wandering (for fixed-spot guards).
  readonly stationary?: boolean;
}

// Spawn-anchored wander config; the entity strolls within ±radius of its spawn X.
export interface AnimatedEntityWanderConfig {
  readonly radius: number;
  // Optional social greeting between wanderers in the same group.
  readonly greet?: AnimatedEntityGreetConfig;
}

// Two wanderers greet when they share a group tag, are within proximityPx, and both are off cooldown.
export interface AnimatedEntityGreetConfig {
  // Group tag — only identical-group wanderers greet each other.
  readonly group: string;
  // Center-to-center distance (px) within which a partner triggers a greeting.
  readonly proximityPx: number;
  // Probability (0–1) that an eligible crossing becomes a greeting.
  readonly chance: number;
  readonly hops: number;
  // Per-instance cooldown (ms) between greetings.
  readonly cooldownMs: number;
}

// Trap parameters; presence signals EntityFactory to spawn a Trap instead of AnimatedEntity.
export interface AnimatedEntityTrapConfig {
  // Damage on body overlap; player invuln window gates re-ticks.
  readonly damage: number;
  // Animation played when the player steps on the trap from above (e.g. bear trap snap).
  readonly directContactAnimation?: string;
  // Virtual damage zone for ejector traps — wider than the physics body so the hazard reaches further.
  readonly damageZone?: {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
  };
}

// One independent drop event; each rolls its own chancePct and weighted kind pick.
export interface AnimatedEntityDropConfig {
  // Probability (0–100) this event fires; 100 = guaranteed.
  readonly chancePct: number;
  // Weighted pickup kind table; weights are relative (normalized by sum).
  readonly kinds: ReadonlyArray<AnimatedEntityDropKindConfig>;
}

export interface AnimatedEntityDropKindConfig {
  readonly kind:
    | 'gun1'
    | 'gun2'
    | 'magic'
    | 'coin'
    | 'heal'
    | 'key_storms'
    | 'key_widow'
    | 'key_heart';
  // Relative weight within this event's kinds table.
  readonly weight: number;
}

export interface AnimatedEntityConfig {
  // Animation key played on spawn; required so partial-anim entities always have a sane default.
  readonly defaultAnimation: string;
  // Source-px body size; AnimatedEntity divides by displayScale so world-space size stays correct.
  readonly physicsBody: AnimatedEntityPhysicsBodyConfig;
  // Opt in to Arcade gravity; default false (entities animate in place).
  readonly gravity?: boolean;
  // All animation keys used elsewhere in this entry must resolve to a key in this map.
  readonly animations: Readonly<Record<string, AnimatedEntityAnimConfig>>;
  // Combat behavior block; presence signals EntityFactory to spawn Enemy.
  readonly behavior?: AnimatedEntityBehaviorConfig;
  // Trap block; presence signals EntityFactory to spawn Trap.
  readonly trap?: AnimatedEntityTrapConfig;
  // Drop events fired on chest-open or enemy-death anim complete; absent = never drops.
  readonly drops?: ReadonlyArray<AnimatedEntityDropConfig>;
}

// LDtk identifier → config; validated at boot.
export type EntityRegistry = Readonly<Record<string, AnimatedEntityConfig>>;
