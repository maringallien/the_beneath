// Schema for the JSON-authored animated-entity registry. Each LDtk entity
// identifier (e.g. "Caged_spider_spawn") maps to one AnimatedEntityConfig
// describing where its sprites live and how to slice the spritesheets into
// frames. The registry is the single source of truth that turns "this LDtk
// identifier should animate" into a runnable Phaser sprite — adding a new
// animated entity type is one JSON entry, not one factory function.

export interface AnimatedEntityAnimConfig {
  // Path of the spritesheet PNG, relative to /public. e.g.
  // "DarkSpriteLib/characters/caged_spider/idle.png".
  readonly file: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  // Default true — a missing field is interpreted as a looping animation.
  // Set false for one-shot animations like death.
  readonly loops?: boolean;
  // Frame-pixel column where the body's horizontal anchor sits. Defaults to
  // frameWidth / 2 (sprite-center). Used by getSpriteAnchor to position the
  // physics body relative to the visible frame, mirroring SimpleAnimation.
  readonly anchorX?: number;
  // Frame-pixel row (1-based from top of frame) where the body's bottom
  // edge sits. Defaults to frameHeight (body bottom = frame bottom).
  readonly anchorY?: number;
  // Frame-pixel row used for spawn position alignment with the LDtk pivot.
  // When set, the spawn logic shifts the sprite so this row lands at the
  // LDtk pivot Y (regardless of pivotY). Lets you align the visible
  // center of a non-floor-anchored entity with its LDtk placement — e.g.
  // a center-pivoted (0.5, 0.5) boss whose visible figure sits in the
  // bottom half of an oversized frame. When omitted, the spawn logic
  // uses anchorY for floor-anchored entities (pivotY=1) and centers the
  // frame for others (pre-spawnAnchorY behavior). Only consulted on the
  // default animation; animation swaps don't reposition the sprite.
  readonly spawnAnchorY?: number;
  // Visual-only scale applied to the rendered sprite. Default 1. Same
  // semantics as FrameData.displayScale on the player registries.
  readonly displayScale?: number;
}

export interface AnimatedEntityPhysicsBodyConfig {
  readonly width: number;
  readonly height: number;
}

// Melee strategies stamp a transient hitbox at this offset on the configured
// attackFrame. Offset is in source pixels; the strategy mirrors X based on
// the entity's facing direction at fire time.
//
// `frame` is melee-only: when set, this hitbox fires on that specific frame
// of the attack animation instead of the attack's default `frame`. Lets a
// single attack stamp multiple rects at different points in the swing (e.g.,
// a two-strike slam where one sword lands on frame 17 and the other on
// frame 21). Each hitbox fires at most once per attack cycle, so a player
// straddling several rects on the same frame still only eats one damage
// tick. Defaults to the attack's `frame` when omitted.
export interface AnimatedEntityHitboxConfig {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly frame?: number;
  // When true, the hitbox geometry above is ignored at fire time and the
  // strategy stamps a rect at the entity's live physics body position+size
  // (this.body.x/y/width/height). Use for "swing lands on the boss body"
  // attacks (e.g. The_heart_hoarder attack2's body-slam) so the hitbox
  // tracks the body across animations regardless of frame anchor/scale.
  // offsetX/Y/width/height are still required by the schema (parser keeps
  // them mandatory to avoid two parsing modes) but unused at runtime when
  // matchBody is set — author them as 0.
  readonly matchBody?: boolean;
}

// Per-character attack tuning. Animation keys reference keys in this entity's
// own `animations` map — never raw Phaser keys — so the registry validator
// can prove they exist at boot. The whole block is optional under behavior:
// entities can be killable without attacking (passive enemies / ambient
// creatures that just take damage), in which case Phase 3's AI loop keeps
// them in 'idle' indefinitely.
//
// Type semantics:
//   - 'melee': transient hitbox on the attack frame
//   - 'ranged'/'magic': projectile spawned on the attack frame
//   - 'contact': damage applied on body-overlap with the player, no anim
//     needed — used for swarm enemies like wasps that "sting on touch"
//   - 'heal': self-cast on a chosen frame, restores HP up to max. Selected
//     by the AI pool only when current HP is below healThreshold (default
//     0.5), so bosses use it when wounded instead of as their opener.
//   - 'dive': commits to a straight-line lunge toward the player at attack
//     entry. The body velocity is set once (distance / animation duration)
//     so the entity reaches the player at the end of the animation; damage
//     applies on body-overlap during the dive. Used for evil_crow and other
//     airborne lungers. Honors `minRange` so a crow won't dive when already
//     adjacent (the body would barely move and the animation would look
//     wrong) — falls back to loiter for closer distances.
//   - 'aoe': plays the boss's wind-up animation; on the configured frame
//     spawns a separate VFX sprite (configured via `vfxAnimation`) at the
//     player's current position. The VFX is a one-shot sprite that
//     damages the player on body-overlap once, then destroys itself on
//     animation complete. Position snapshot at spawn gives the player a
//     dodge window during the VFX's wind-down. Honors `minRange` so the
//     boss saves the heavy attack for when the player is out of melee
//     range (typical boss-design pattern).
//   - 'teleport': two- or three-phase blink-strike. Plays `disappearAnimation`
//     at the current position; on completion, repositions the body to
//     (player.x, ground + targetOffsetY). With `appearAnimation` unset (two-
//     phase), plays `animation` directly at the destination — the animation
//     IS both the visual reappear and the damage clip. With `appearAnimation`
//     set (three-phase), plays that visual-only reappear clip first, then
//     plays `animation` (the strike with the damage frame). Damage applies on
//     melee-style hitbox(es) stamped on the configured `frame` of `animation`
//     (single-area) or per-hitbox `frame` overrides on `hitboxes` (multi-area,
//     e.g. teleport-into-slam with body + side hits on different frames).
//     Honors `minRange` so the boss reserves the teleport for when the player
//     is at a distance instead of using it as a stutter-step. Gravity is
//     suppressed for the duration of the attack so the appear pose doesn't
//     fall during the strike; restored when the attack ends, on hurt-interrupt,
//     or on death.
//   - 'summon': plays a cast animation and, on the configured frame, spawns
//     `summonCount` minions (each kind chosen at random from `summonKinds`,
//     which must be registry identifiers) beside the caster. Deals no direct
//     damage. `range` gates it like a normal attack so the caster only summons
//     once the player is engaged; `cooldownMs` throttles re-casts and the
//     optional `summonMaxAlive` caps how many of this caster's minions can be
//     alive at once. The spawned minions are wired into the world as ordinary
//     enemies (full AI/collision) and immediately pursue the player.
export interface AnimatedEntityAttackConfig {
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
  // Animation key. Required for melee/ranged/magic/heal/dive; optional for
  // contact (which has no swing animation — the enemy walks into the
  // player while playing its default walk/idle).
  readonly animation?: string;
  // Frame index (0-based, must be < animations[animation].frameCount) at
  // which damage / projectile spawn / self-heal applies. Required for
  // melee/ranged/magic/heal; ignored for contact and dive (dive damages
  // on overlap throughout, not on a single frame). For AoE: exactly one of
  // `frame` (single-fire) or `damageFrames` (multi-fire) must be set.
  readonly frame?: number;
  // 'aoe'-only: list of frame indices, each of which fires its own damage
  // rect once per swing. Use for attacks whose visible animation strikes
  // multiple times — e.g. a two-stomp combo where the body slams on frame 2
  // and the follow-through slams again on frame 9. Each frame fires
  // independently and stamps a fresh rect at the player's current position,
  // so a player who held still for the first hit can still dodge the second.
  // Mutually exclusive with `frame`. Frames must be in 0..frameCount-1 and
  // unique. Order doesn't matter (frames fire in ascending animation order
  // regardless of array order).
  readonly damageFrames?: ReadonlyArray<number>;
  // Damage to the player. Required for non-heal types.
  readonly damage?: number;
  // HP restored on a heal-type attack's frame. Required when type === 'heal'.
  readonly heal?: number;
  // Fraction (0..1) of max HP below which the heal becomes eligible. Default
  // 0.5 — boss heals when bloodied, not as an opener. Heal-only field.
  readonly healThreshold?: number;
  // World-pixel distance within which the entity initiates the attack.
  // Required for melee/ranged/magic/dive (the entity must close to attack);
  // unused by contact (handled via body overlap) and heal (self-cast).
  readonly range?: number;
  // World-pixel distance below which the attack will NOT initiate. Used by
  // 'dive' to prevent point-blank dives that look like a stutter — the
  // entity loiters instead and waits to be far enough to commit. Must be
  // < range when set. Other types ignore this field.
  readonly minRange?: number;
  readonly cooldownMs: number;
  // Per-attack lockout. When set, this specific attack becomes ineligible
  // for `recastCooldownMs` after it fires (independent of the global
  // post-attack `cooldownMs` recover window). Lets bosses keep meleeing
  // while a signature heavy attack is on its own longer timer — set on
  // attack3 for Shadow_of_storms so it's a rare burst, not a spammed
  // pick. If unset, `cooldownMs` alone gates re-firing via the global
  // recover state.
  readonly recastCooldownMs?: number;
  // Relative probability when the AI picks from multiple eligible attacks in
  // `attackPool`. Default 1 (uniform). Higher values mean this entry is
  // chosen more often; e.g., weight 3 vs 1 makes this attack ~3× as likely
  // as the other. Has no effect when only one attack is eligible.
  readonly weight?: number;
  // Combo chaining: when this attack's animation completes, with
  // `comboChancePct` probability immediately launch the pool attack whose
  // `animation` key equals `comboNextAnimation`, skipping the usual
  // recover/cooldown gap so the pair reads as one 1-2 combo. The follow-up
  // runs its own full swing (damage frame, hitbox, then its own recover +
  // cooldown). Only chains while the player is within this (lead) attack's
  // `range` so the follow-up doesn't whiff into empty space, and only if the
  // follow-up isn't on its own recastCooldownMs. melee/ranged/magic only.
  // `comboNextAnimation` must match another pool entry's `animation` key.
  readonly comboNextAnimation?: string;
  // Probability (0 < n <= 100) of chaining into comboNextAnimation. Required
  // when comboNextAnimation is set; ignored otherwise.
  readonly comboChancePct?: number;
  // When true, this attack is never selected on its own by the AI pool — it
  // only ever runs as another attack's `comboNextAnimation` follow-up. Lets you
  // author a strict "B only after A" chain (e.g. an assassin whose attack2 is
  // purely a finisher to attack1). melee/ranged/magic only. Because the attack
  // is never independently selected, its `range` is optional (reachability is
  // inherited from the lead attack's range check at combo time); it still needs
  // its own animation/frame/damage/hitbox to deliver the follow-up hit.
  readonly comboOnly?: boolean;
  // Melee-only: forward distance (source px) the body advances when the swing
  // completes. For attacks whose ART bakes a forward lunge into the frames
  // (the character slides forward across the strip) while the body holds still:
  // without this, the entity visibly snaps back to the launch point when it
  // returns to idle. Setting it to roughly the art's forward travel moves the
  // body to where the lunge landed so idle resumes seamlessly. Applied in the
  // entity's facing direction; skipped if the swing is interrupted (hurt/death)
  // or chains into a combo follow-up. Default unset (no advance).
  readonly lungeDistance?: number;
  readonly aggressive: boolean;
  // Optional chase fields. If chaseRange is set, the entity moves toward
  // the player when within that range. Absent = stationary attacker.
  readonly chaseRange?: number;
  readonly moveSpeed?: number;
  readonly walkAnimation?: string;
  // Melee/teleport: transient hitbox geometry stamped on the damage frame.
  // Use `hitbox` for a single strike area, or `hitboxes` for multi-area
  // attacks (e.g., a slam that damages the body plus two sword tips). The
  // validator accepts either form in JSON and normalizes to `hitboxes`
  // internally, so strategy code reads the array uniformly. Exactly one
  // of the two must be set when the attack delivers damage via overlapRect.
  readonly hitboxes?: ReadonlyArray<AnimatedEntityHitboxConfig>;
  // Ranged/magic-only: projectile animation keys + speed.
  readonly projectileAnimIdle?: string;
  readonly projectileAnimExplode?: string;
  readonly projectileSpeed?: number;
  // Ranged/magic-only: world-pixel offset from the entity sprite center where
  // the projectile spawns. X is mirrored based on facing (positive = front);
  // Y is not flipped (positive = down). Defaults to (0, 0) — sprite center.
  // Use this for tall sprites whose visible cast point (arm tip, weapon
  // muzzle) sits far from the sprite center, e.g. The_tarnished_widow
  // whose 188x90 sprite has a 48x45 body anchored at the sprite bottom,
  // so the sprite center sits high above her head.
  readonly projectileOriginX?: number;
  readonly projectileOriginY?: number;
  // Ranged/magic-only: when true, the projectile flies straight along the
  // entity's facing (horizontal, vy = 0) instead of aiming at the player. The
  // player dodges by changing elevation rather than just sidestepping. Default
  // false — projectiles home onto the player's position at fire time. Used by
  // turret-style shooters (hell bot, wheel bot) that fire fixed volleys.
  readonly projectileStraight?: boolean;
  // projectileStraight-only: opt-in vertical-alignment gate. A straight shot
  // flies horizontally, so it can only connect when the muzzle's Y line passes
  // through the player's body. When set, the attack becomes ineligible while the
  // player sits on a different elevation (the muzzle Y is outside the player's
  // body height, expanded by this margin in px) — so a mobile shooter like the
  // hell bot falls through to chase and repositions onto the player's row (or
  // closes for melee) instead of firing volleys that sail over/under them.
  // Unset = legacy behavior: fire whenever the 2D distance is in range,
  // regardless of elevation (correct for a stationary turret that can't
  // reposition, e.g. the wheel bot). Only valid with projectileStraight=true.
  readonly verticalAlignMarginPx?: number;
  // 'summon'-only: registry identifiers of the minions to spawn (e.g.
  // ["Ghoul_spawn", "Spitter_spawn"]). Each summoned unit picks one entry at
  // random. Must be a non-empty array of identifiers that resolve to a
  // behavior-bearing registry entry at runtime; an unresolvable id is skipped.
  readonly summonKinds?: ReadonlyArray<string>;
  // 'summon'-only: how many minions to spawn per cast (clamped by
  // summonMaxAlive when set). Positive integer.
  readonly summonCount?: number;
  // 'summon'-only: optional cap on how many of THIS caster's still-alive
  // minions may exist at once. A cast spawns only up to the remaining budget,
  // so a long fight can't snowball into an endless horde. Omit for no cap.
  readonly summonMaxAlive?: number;
  // 'aoe'-only: animation key (within this entity's `animations` map)
  // played by the VFX sprite that spawns at the player's snapshot
  // position on the damage frame. Must be one-shot. When omitted, the
  // AoE is sprite-less — damage is delivered via a one-shot rect overlap
  // at the snapshot position (still respects vfxDelayMs for the dodge
  // window). Use sprite-less for spells whose impact is conveyed by the
  // caster's own animation/sound, not a separate hit visual.
  readonly vfxAnimation?: string;
  // 'aoe'-only: if true, the damage-frame VFX (and its damage payload) is
  // suppressed when the player isn't grounded. The boss's wind-up animation
  // still plays — the player simply rewards a well-timed jump with zero
  // damage. Set on Shadow_of_storms attack3 so the ground-impact VFX never
  // pops in mid-air. Default false; other AoE attacks fire regardless of
  // the player's vertical state.
  readonly requireGroundedTarget?: boolean;
  // 'aoe'-only: when set together with requireGroundedTarget, refines the
  // binary "any airborne = dodge" check into a vertical-clearance threshold.
  // Computed at the damage frame as (nearest solid tile below player) -
  // player.body.bottom. Only clearances >= this value dodge the strike;
  // small hops still get hit. Designed for AoEs where a flick of the jump
  // button shouldn't be enough — the player has to actually leap. No-op
  // without requireGroundedTarget. Default undefined (binary behavior).
  readonly minAirborneDodgeClearancePx?: number;
  // 'aoe'-only: if true, the VFX spawn point is projected straight down from
  // the player's snapshotted position to the first solid tile beneath them.
  // Lets ground-impact strikes (orb_mage attack1, Shadow_of_storms attack3)
  // visually land on the floor even when the player is mid-jump, instead of
  // popping into the air at the player's body bottom. Paired with vfxDelayMs
  // it gives the player a real dodge window: jump → boss snapshots position →
  // VFX lands on the ground under the snapshot a moment later. Default false.
  readonly groundProjectVfx?: boolean;
  // 'aoe'-only: if true, the strike is suppressed when there's a solid tile
  // directly above the player at the damage frame — used for arrow-volley
  // style attacks (Archer_bandit) where the projectile rains from above and
  // shouldn't hit a player standing in a tunnel or under a ceiling. The
  // wind-up animation still plays; the player is rewarded for sheltering.
  // Default false; other AoE attacks fire regardless of overhead geometry.
  readonly requireOpenSky?: boolean;
  // 'aoe'-only: delay in milliseconds between the damage-frame trigger and
  // the VFX sprite actually spawning. Player position is still snapshotted
  // at the damage frame, so the delay is the dodge window. Default 0 (VFX
  // spawns immediately). Used for arrow-volley style attacks where arrows
  // visibly travel through the air before landing.
  readonly vfxDelayMs?: number;
  // 'aoe'-only: sound id (from soundRegistry) played in sync with the VFX.
  // Without vfxSoundLeadMs, fires at the spawn moment. With lead, fires
  // earlier so the sound's audible peak aligns with the VFX appearing
  // (e.g. arrows whistling/landing — impacts cluster on the first few VFX
  // frames). Cleaner than wiring a frame trigger on the wind-up animation
  // when there's a delay between the two.
  readonly vfxSoundId?: string;
  // 'aoe'-only: how many milliseconds before VFX spawn to start the
  // vfxSoundId clip. Capped at vfxDelayMs (can't fire before the trigger).
  // Use to align the sound's audible peak with the VFX onset for sounds
  // whose impacts are front-loaded (the audio "ends" when the visual
  // appears). Default 0 — sound fires at the moment of VFX spawn.
  readonly vfxSoundLeadMs?: number;
  // 'aoe'-only: damage-source tag passed through to Player.hurt(). Drives
  // the player's hurt-sound variant (e.g. arrow-impact grunt vs melee
  // grunt). Use 'projectile' for arrow-rain / ranged AoEs and 'melee' (or
  // omit) for ground-strike / shockwave AoEs. Default omitted — falls back
  // to the melee grunt.
  readonly hurtSource?: 'melee' | 'projectile';
  // 'aoe'-only (sprite-less path): half-width in source pixels of the
  // damage rect stamped at the snapshotted strike point. Total rect width
  // = damageHalfWidth * 2. Defaults to the sprite-less constant (24 px →
  // 48 px wide rect). Set to tighten or widen the horizontal dodge window
  // per attack — e.g. The_heart_hoarder's attack3 uses a narrower rect so
  // a sidestep actually dodges the strike. No-op when vfxAnimation is set
  // (VFX path uses sprite-on-player overlap instead of overlapRect).
  readonly damageHalfWidth?: number;
  // 'aoe'-only (sprite-less path): half-height in source pixels of the
  // damage rect. Total rect height = damageHalfHeight * 2, anchored at the
  // player's feet (rect extends upward from the snapshotted body.bottom).
  // Defaults to the sprite-less constant (32 px → 64 px tall rect).
  // Same vfxAnimation-gated semantics as damageHalfWidth.
  readonly damageHalfHeight?: number;
  // 'teleport'-only: wind-up animation key played at the entity's pre-teleport
  // position. Must be one-shot.
  readonly disappearAnimation?: string;
  // 'teleport'-only: optional visual reappear clip played at the destination
  // between the disappear clip and the damage-bearing `animation`. When set,
  // the teleport becomes three-phase: disappear → appear (visual only, no
  // damage frame) → strike (`animation`). Must be one-shot. Use when the
  // damage animation (e.g. a long attack1) lacks a dedicated reappear pose
  // at frame 0 — without an appearAnimation the boss snaps directly into
  // the strike pose, which feels abrupt when the damage frame happens many
  // frames later. If unset, the two-phase legacy behavior is preserved
  // (animation IS both the reappear and strike clip — used by entities like
  // The_tarnished_widow whose teleport_appear carries the damage frame itself).
  readonly appearAnimation?: string;
  // 'teleport'-only: vertical pixel offset from the ground beneath the player
  // at the appear destination. The body's bottom is ground-projected (walks
  // down from the player to the first solid tile) and this offset is applied
  // on top: 0 = standing on the ground, negative = above (boss drops from
  // above for a falling-strike framing), positive = below. Default -80 (about
  // 5 tiles above the floor).
  readonly targetOffsetY?: number;
  // 'teleport'-only, three-phase only: when true, the appear (reappear-visual)
  // clip lands ELEVATED by one body-height above the strike target — used by
  // slam-style strikes whose frame 0 shows the boss raised in the air so the
  // body falls into the strike target during the appear clip. Default false:
  // the boss reappears at ground level (correct for ground-stance follow-ups
  // like attack2/attack3).
  readonly appearElevated?: boolean;
}

// Per-character combat parameters. Presence of a behavior block is the one
// signal the EntityFactory uses to spawn Enemy vs AnimatedEntity. An
// attack-less behavior (just health) is valid and produces a killable but
// passive enemy.
export interface AnimatedEntityBehaviorConfig {
  readonly health: number;
  // Animation played on take damage. Optional — some entities lack a
  // take_hit sheet, in which case the entity flickers via i-frame logic
  // without an animation swap.
  readonly hurtAnimation?: string;
  // Sound id (from soundRegistry) played when the entity takes a non-lethal
  // hit. Decoupled from `hurtAnimation` so entities without a take_hit sheet
  // (e.g. the bandits) can still vocalize on hit. Suppressed on the killing
  // blow so the death sound isn't doubled up with a hurt grunt.
  readonly hurtSoundId?: string;
  // Sound id (from soundRegistry) played once the first time the player
  // crosses inside encounterRadius. Used for boss-encounter stingers. Fires
  // exactly once per Enemy instance — a respawn after death gets a fresh
  // sting, but re-aggro within the same instance does not. Decoupled from
  // chase/aggro so non-chasing bosses (immovable) still trigger it.
  readonly encounterSoundId?: string;
  // Optional pixel distance at which the encounter trigger fires. Defaults
  // to 300px when omitted — large enough to feel like "stepping into the
  // arena" rather than "right next to the boss". Ignored when both
  // encounterSoundId and engageDelayMs are unset. Also ignored for arena-
  // bound bosses (stayInSpawnLevel=true) — those use the spawn-level rect
  // as the engagement zone instead, which works for airborne bosses where
  // 2D distance never drops below a small radius due to vertical separation.
  readonly encounterRadius?: number;
  // Dormant-until-spotted behavior. When set, the entity starts inert: it
  // holds its asleep pose (a looping `sleepAnimation` when set, otherwise the
  // first frame of `wakeAnimation` paused), runs no chase/attack/encounter
  // logic, and ignores the player entirely until it gains line of sight
  // (`trigger: 'lineOfSight'`) to the player within
  // `range` px (defaults to a screen-ish radius). On first sight it plays
  // `wakeAnimation` once, then hands off to the normal AI loop — which then
  // idles until the player is within an attack's `range` and engages. Used for
  // ambush turrets like the wheel bot that should not react across a room they
  // can't see into. `wakeAnimation` must be one-shot.
  readonly dormant?: {
    readonly wakeAnimation: string;
    readonly trigger: 'lineOfSight';
    readonly range?: number;
    // Optional looping clip shown while dormant (e.g. the wheel bot's curled
    // 'sleep'). When omitted, the entity holds the first frame of
    // `wakeAnimation` paused as its asleep pose (legacy behavior).
    readonly sleepAnimation?: string;
  };
  // Optional delay (ms) between the player crossing encounterRadius and the
  // boss beginning to attack/chase. During the delay the boss stays in its
  // idle pose, giving the player time to actually enter the arena before
  // the boss commits (e.g. The_heart_hoarder: without a delay it teleports
  // onto the player the moment the level loads). Triggered by the same
  // encounterRadius check that fires encounterSoundId, so set encounterRadius
  // alongside this when the default 300 px isn't right. Ignored when 0/unset
  // — the boss engages immediately on first sight (legacy behavior).
  readonly engageDelayMs?: number;
  // Animation played on death. Defaults to 'death' (when an animation with
  // that key exists). Validator confirms the key resolves to a real anim.
  readonly deathAnimation?: string;
  // If true, the entity ignores knockback velocity on hurt and is marked
  // body.immovable in physics so the player can't push it either. Use for
  // anchored enemies like The_hive that must stay at their LDtk position.
  readonly immovable?: boolean;
  // If true, chase/loiter/patrol velocity updates only drive X; Y is forced
  // to 0. Use for gravity-off bosses that should glide along a horizontal
  // line and only change elevation through attack-driven repositioning
  // (e.g. The_heart_hoarder's teleport attack1). Has no effect on
  // gravity-on bodies — those already gate Y via the gravity check.
  readonly horizontalMovementOnly?: boolean;
  // If true, the entity captures the LDtk level rect it spawned in and
  // clamps body position + teleport destinations to stay inside it. Use for
  // arena-bound bosses that should not chase the player out of their fight
  // (e.g. The_heart_hoarder confined to Level_15). No-op for entities
  // spawned in inter-level whitespace where the rect lookup returns null.
  readonly stayInSpawnLevel?: boolean;
  // Pixel radius of a chase "leash" centered on the entity's home anchor (set
  // at spawn by GameScene — for wasps, the nearest hive's position, or the
  // wasp's own spawn point when its level has no hive). The entity only chases
  // while the player is within this distance of the home anchor; beyond it it
  // breaks off — even mid-aggro — and drifts back to loiter around home. Makes
  // hive-tethered swarmers defend a territory instead of trailing the player
  // across the map. No effect on entities that never receive a home anchor
  // (the leash check is gated on one being set). Forced convergence (boss
  // round-fight) overrides the leash so arena scripting still pulls them in.
  readonly homeLeashRange?: number;
  // If true, this enemy is treated as a boss for the auto-respawn system —
  // i.e. it does NOT come back after the player kills it. Non-boss enemies
  // re-spawn at their original LDtk position once ENEMY_RESPAWN_MIN_TIME_MS has
  // passed AND the player is ENEMY_RESPAWN_MIN_DISTANCE_PX away. Independent of stayInSpawnLevel,
  // encounterSoundId, etc. so a future "boss" that isn't arena-bound or
  // doesn't get a sting can still opt out of respawning.
  readonly isBoss?: boolean;
  // Opt this boss into the 3-round fight system. When true: the floating
  // combat health bar is suppressed in favor of a screen-wide segmented bar
  // at the top of the UI (GameScene/BossHud), the "Round N" banner fires on
  // engage and at each threshold, and the boss freezes + is invulnerable for
  // BOSS_ROUND_BREAK_MS each time it loses 1/BOSS_ROUND_COUNT of its health.
  // Independent of `isBoss` so a boss can exist without the round treatment
  // (e.g. The_blood_king). The HP pool is split into BOSS_ROUND_COUNT equal
  // sections — set `health` to a value divisible by it for clean thirds.
  readonly roundFight?: boolean;
  // Human-readable name shown on the boss round-fight bar (e.g. "Shadow of
  // Storms"). Only consumed when roundFight is true. Falls back to a name
  // derived from the entity identifier when omitted.
  readonly displayName?: string;
  // Patrol movement, decoupled from combat. The AI's loiter/patrol code reads
  // movement from the lead attack when one exists (legacy combat entities), and
  // falls back to these fields otherwise — so an attack-less character (e.g.
  // spirit walkers) walks its LDtk loiterPath under gravity using the exact
  // same patrol code as any other character. walkAnimation must resolve to an
  // animation key; moveSpeed is world px/s. Ignored when attacks[0] already
  // supplies walkAnimation/moveSpeed, so existing enemies are unaffected.
  readonly walkAnimation?: string;
  readonly moveSpeed?: number;
  // Single-attack shorthand. For enemies with one combat behavior. Mutually
  // exclusive with attackPool in practice — if both are set, attackPool wins
  // and attack is ignored (validator warns at boot).
  readonly attack?: AnimatedEntityAttackConfig;
  // Multi-attack pool. Boss-style enemies pick a random eligible entry per
  // attack cycle (eligible = type matches the current situation: melee/
  // ranged in range, heal when HP below threshold, contact always evaluated
  // independently on body overlap). Empty array is invalid; use the single
  // `attack` field instead.
  readonly attackPool?: ReadonlyArray<AnimatedEntityAttackConfig>;
  // If true, the floating combat health bar is suppressed entirely for this
  // entity. Use for swarm minions whose individual HP doesn't matter (Wasps),
  // anchored set-pieces with no meaningful HP feedback (The_hive), or bosses
  // that should get a different UI treatment later. Other enemies show the
  // bar automatically once the player damages them. Default omitted (= bar
  // appears on first player hit).
  readonly hideHealthBar?: boolean;
  // Per-entity vertical nudge for the floating HP bar, in source pixels.
  // Positive = move the bar HIGHER above the body; negative = move it lower.
  // Default 0. Use for entities whose visible top sits well above body.top
  // (oversized frames with the body anchored low — e.g. The_heart_hoarder)
  // where the default 6 px gap above body.top reads as "inside the sprite"
  // rather than "above its head".
  readonly healthBarOffsetY?: number;
  // When the player fires a projectile within `triggerRangePx`, the entity
  // immediately interrupts whatever it's doing and fires one of its own
  // `type: 'teleport'` attacks from the attackPool — closing the gap and
  // forcing the player into melee. Bypasses the chosen attack's
  // recastCooldownMs so the boss can always react; this block's `cooldownMs`
  // is the only throttle on back-to-back reactions. No-op if attackPool has
  // no teleport entries. Omit to disable.
  readonly dodgeOnProjectile?: {
    // Pixel radius around the entity; only projectiles spawned within this
    // distance trigger the reaction. Sized to "saw it coming," not infinite —
    // a shot from the far side of the arena shouldn't pull the boss across
    // the room.
    readonly triggerRangePx: number;
    // Minimum ms between projectile-triggered teleports. Prevents the boss
    // from teleport-locking itself when the player spam-fires.
    readonly cooldownMs: number;
  };
  // When set, the entity emits an instantaneous circular damage burst on
  // the configured frame of its death animation. Hits the player and every
  // other live Enemy whose body center sits inside the radius — friendly
  // fire is intentional so a hive bursting can wipe its own swarm. Self is
  // excluded. When the entity has no death animation registered, the burst
  // fires immediately on entering the dead state instead, since there's no
  // frame timeline to align to. Use for entities whose death is a hazard
  // rather than a passive corpse (e.g. The_hive). Omit to disable.
  readonly deathExplosion?: {
    // Damage applied to each entity caught in the blast.
    readonly damage: number;
    // Blast radius in source pixels, measured from the entity's body
    // center. The center-vs-center distance check means a target's body
    // edge can extend slightly past the radius and still be hit, which
    // reads as expected for explosive AoE.
    readonly radius: number;
    // Frame index (0-based) of the death animation at which the burst
    // fires. Aligns the damage moment with the visible blast peak instead
    // of the first frame of the death animation. Validated against the
    // death animation's frameCount at boot when the death anim exists.
    readonly frame: number;
  };
  // Spawn-anchored ground wander (see Enemy.updateAreaWander). When set on a
  // grounded character that has no authored loiterPath, it strolls within
  // `radius` px of its spawn point — resting between strolls and using the
  // shared leap probe to hop level gaps that land back in-bounds — instead of
  // standing idle. Without this block such a character just idles (unchanged).
  readonly wander?: AnimatedEntityWanderConfig;
}

// Spawn-anchored wander parameters (behavior.wander). Presence on a grounded
// character makes it stroll around its spawn point instead of standing idle
// when it has no authored loiterPath — see Enemy.updateAreaWander.
export interface AnimatedEntityWanderConfig {
  // Horizontal half-width (world px) of the stroll zone, centered on the
  // entity's spawn X. Targets are picked within ±radius; a gap whose landing
  // would fall outside this band is declined (the entity turns back) so it
  // stays in its vicinity and never strolls off down a hole.
  readonly radius: number;
  // Optional social greeting. When two wandering characters that share the same
  // `group` tag cross paths, they occasionally stop, face each other, and bob a
  // few tiny hops. Omit for solitary wanderers.
  readonly greet?: AnimatedEntityGreetConfig;
}

// Greeting parameters (behavior.wander.greet). Two wanderers are greet-eligible
// when both share `group`, are within `proximityPx` on the same floor, and are
// each off cooldown; on an eligible crossing the initiator rolls `chance` and,
// on success, pulls its partner into a synchronized greet of `hops` tiny bobs.
export interface AnimatedEntityGreetConfig {
  // Match tag. Only wanderers with an identical group greet each other, so the
  // seven Spirit_walker* variants (distinct identifiers) all share one tag.
  readonly group: string;
  // Center-to-center distance (world px) within which a partner triggers a
  // greeting. Small — an arm's length, not across the room.
  readonly proximityPx: number;
  // Probability (0–1) that an eligible crossing actually becomes a greeting, so
  // they don't greet on every single pass.
  readonly chance: number;
  // How many tiny hops each participant performs per greeting.
  readonly hops: number;
  // Per-instance cooldown (ms) after a greeting before this character greets
  // again, so a clustered pair doesn't greet on a loop.
  readonly cooldownMs: number;
}

// Per-entity trap parameters. Presence of this block is the signal the
// EntityFactory uses to spawn a Trap (vs plain AnimatedEntity for pure
// decoration). Mutually exclusive with `behavior` in practice — traps are
// stationary damage sources without health or AI.
export interface AnimatedEntityTrapConfig {
  // Damage dealt to the player on body overlap. Player's invuln window
  // (PLAYER_INVULN_MS) gates re-ticks so a player sitting on a trap takes
  // damage at the invuln cadence, not per-frame.
  readonly damage: number;
  // Optional animation key (within this entity's `animations` map) played
  // when the player makes direct ground-contact with the trap (steps on
  // it from above). Used by the bear trap to switch from the armed loop
  // (`bear_trap_animation1`) to the snap animation (`bear_trap_animation2`).
  readonly directContactAnimation?: string;
  // Optional virtual damage zone for ejector traps. When set, the ejector's
  // trigger condition and overhead damage check use this rect (centered on
  // the body, shifted by offsetX/offsetY) instead of the physics body. Lets
  // the body stay tight around the visible device — so bullets and sword
  // swings stop right at the device sprite — while the shock area (the
  // actual hazard) reaches further out to catch the player. Width/height
  // in source pixels; offsets relative to the body center.
  readonly damageZone?: {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
  };
}

// One independent drop event. Sources expose an array of these (see
// AnimatedEntityConfig.drops) so a chest can guarantee both an ammo pickup
// AND a magic orb in a single open, while an enemy can stay at one event.
// Each event rolls its own chancePct and weighted kind pick independently
// of the others.
export interface AnimatedEntityDropConfig {
  // Probability (0-100) that this event fires. 100 = guaranteed.
  readonly chancePct: number;
  // Weighted table of pickup kinds. Weights are relative — `[{kind:'gun1',
  // weight:2}, {kind:'gun2', weight:1}]` is "2x as likely to be gun1 as gun2".
  // Caller normalizes by summing weights. Must be non-empty.
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
    | 'key_widow';
  readonly weight: number;
}

export interface AnimatedEntityConfig {
  // Name of the animation key (within `animations`) that the entity plays
  // on spawn. Required so partial-anim entities (e.g. The_hive has only
  // idle + death, no walk) declare a sensible default and the system never
  // has to guess.
  readonly defaultAnimation: string;
  // Per-entity physics body. Width/height in source pixels (pre-scale);
  // AnimatedEntity divides by displayScale internally so the world-space
  // hitbox stays at this size regardless of the sprite's display scale.
  readonly physicsBody: AnimatedEntityPhysicsBodyConfig;
  // Whether Arcade gravity affects this entity. Default false: the baseline
  // pipeline animates entities in place without AI/physics, so gravity is
  // off by default to prevent unanchored entities from falling through the
  // world. Per-entity override lets ground-bound enemies opt into gravity
  // when AI/wander is added later.
  readonly gravity?: boolean;
  readonly animations: Readonly<Record<string, AnimatedEntityAnimConfig>>;
  // Optional behavior block. Presence of this field is the one signal the
  // EntityFactory uses to instantiate Enemy vs AnimatedEntity. Absence ==
  // pure-decoration entity (chests, ambient animals, traps).
  readonly behavior?: AnimatedEntityBehaviorConfig;
  // Optional trap block. Presence of this field makes the entity a Trap —
  // overlap-based damage source with no health/AI. The X-aligned "directly
  // above/under" semantics fall out of Arcade's bounding-box overlap when
  // the trap's physicsBody is sized to match its visible damage zone.
  readonly trap?: AnimatedEntityTrapConfig;
  // Optional drops array. Each entry is an independent drop event; on a
  // qualifying trigger (chest open complete, enemy death anim complete) the
  // source rolls each event and spawns a pickup for each successful roll.
  // Absent or empty = entity never drops. Chests typically have two events
  // (ammo + orb), enemies usually one.
  readonly drops?: ReadonlyArray<AnimatedEntityDropConfig>;
}

export type EntityRegistry = Readonly<Record<string, AnimatedEntityConfig>>;
