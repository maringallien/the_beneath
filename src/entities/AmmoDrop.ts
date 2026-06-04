import Phaser from 'phaser';
import {
  AMMO_DROP_BODY_HEIGHT_PX,
  AMMO_DROP_BODY_WIDTH_PX,
  AMMO_DROP_DISPLAY_SCALE,
  AMMO_DROP_DRAG_X,
  AMMO_DROP_LIFETIME_MS,
  AMMO_DROP_SPAWN_VELOCITY_X_JITTER,
  AMMO_DROP_SPAWN_VELOCITY_Y,
  AMMO_PICKUP_GUN1_AMOUNT,
  AMMO_PICKUP_GUN2_AMOUNT,
  COIN_DRAG_X,
  COIN_DROP_DISPLAY_SCALE,
  COIN_PICKUP_AMOUNT,
  COIN_SPAWN_VELOCITY_X_JITTER,
  COIN_SPAWN_VELOCITY_Y_MAX,
  COIN_SPAWN_VELOCITY_Y_MIN,
  COIN_TEXTURE_KEY,
  ENTITY_DEPTH,
  HEAL_PICKUP_AMOUNT,
  HEART_DROP_DISPLAY_SCALE,
  HEART_TEXTURE_KEY,
  KEY_DROP_DISPLAY_SCALE,
  KEY_PICKUP_AMOUNT,
  KEY_TEXTURE_KEY,
  MAGIC_ORB_LOITER_X_AMPLITUDE_PX,
  MAGIC_ORB_LOITER_X_PERIOD_MS,
  MAGIC_ORB_LOITER_Y_AMPLITUDE_PX,
  MAGIC_ORB_LOITER_Y_PERIOD_MS,
  MAGIC_ORB_SPAWN_Y_OFFSET_PX,
  MAGIC_ORB_TEXTURE_KEY,
  MAGIC_PICKUP_AMOUNT,
  MIST_PARTICLE_ALPHA_END,
  MIST_PARTICLE_ALPHA_START,
  MIST_PARTICLE_EMIT_FREQUENCY_MS,
  MIST_PARTICLE_EMIT_RADIUS_PX,
  MIST_PARTICLE_LIFESPAN_MAX_MS,
  MIST_PARTICLE_LIFESPAN_MIN_MS,
  MIST_PARTICLE_SCALE_END,
  MIST_PARTICLE_SCALE_START,
  MIST_PARTICLE_SPEED_MAX,
  MIST_PARTICLE_SPEED_MIN,
  MIST_PARTICLE_TEXTURE_KEY,
} from '../constants';
import type { AnimatedEntityDropConfig } from './entityRegistryTypes';
import type { PickupKind } from './Player';

// hud_ammo is a 6x3 grid of 16x16 tiles loaded by PreloadScene. Row 0 col 0
// is the pistol bullet (gun1); row 2 col 0 is the shotgun shell (gun2). The
// HUD references these same frames, so the world-drop visual matches the
// inventory icon without an additional asset. magic_orb is a procedurally
// generated single-frame texture (see PreloadScene.generateMagicOrbTexture).
const HUD_AMMO_TEXTURE_KEY = 'hud_ammo';
const GUN1_FRAME = 0;
const GUN2_FRAME = 12;

interface TextureChoice {
  readonly key: string;
  readonly frame: number | undefined;
  readonly scale: number;
}

function textureForKind(kind: PickupKind): TextureChoice {
  if (kind === 'gun1') {
    return { key: HUD_AMMO_TEXTURE_KEY, frame: GUN1_FRAME, scale: AMMO_DROP_DISPLAY_SCALE };
  }
  if (kind === 'gun2') {
    return { key: HUD_AMMO_TEXTURE_KEY, frame: GUN2_FRAME, scale: AMMO_DROP_DISPLAY_SCALE };
  }
  if (kind === 'magic') {
    // Magic orb: 12px procedural texture, same 0.5× scale as ammo so the visible
    // footprint matches. LINEAR filtering on the texture (set in PreloadScene)
    // keeps the circle smooth despite the global pixelArt config.
    return { key: MAGIC_ORB_TEXTURE_KEY, frame: undefined, scale: AMMO_DROP_DISPLAY_SCALE };
  }
  if (kind === 'heal') {
    // Healing heart: 16px procedural texture. Slightly larger display scale
    // than ammo/orb so the rarer pickup stands out; LINEAR-filtered in
    // PreloadScene so the curves stay smooth at zoom. Uses the default ammo
    // physics branch below (gravity + pop), so a dropped heart falls and
    // settles like an ammo pickup rather than hovering like a magic orb.
    return { key: HEART_TEXTURE_KEY, frame: undefined, scale: HEART_DROP_DISPLAY_SCALE };
  }
  if (kind === 'key_storms' || kind === 'key_widow') {
    // Boss key: 16px procedural gold key. Both keys share one texture (they're
    // visually identical; door-matching is by pickup kind). Falls under the
    // default ammo physics branch below (gravity + pop) so it drops and settles
    // where the boss died rather than hovering like a magic orb.
    return { key: KEY_TEXTURE_KEY, frame: undefined, scale: KEY_DROP_DISPLAY_SCALE };
  }
  // Coin: procedural gold disc authored at 32 px source resolution for HUD
  // sharpness; COIN_DROP_DISPLAY_SCALE shrinks it back to ~4 world units so
  // world coins still read as smaller "minor pickups" than the magic orb.
  return { key: COIN_TEXTURE_KEY, frame: undefined, scale: COIN_DROP_DISPLAY_SCALE };
}

function amountForKind(kind: PickupKind): number {
  if (kind === 'gun1') return AMMO_PICKUP_GUN1_AMOUNT;
  if (kind === 'gun2') return AMMO_PICKUP_GUN2_AMOUNT;
  if (kind === 'magic') return MAGIC_PICKUP_AMOUNT;
  if (kind === 'heal') return HEAL_PICKUP_AMOUNT;
  if (kind === 'key_storms' || kind === 'key_widow') return KEY_PICKUP_AMOUNT;
  return COIN_PICKUP_AMOUNT;
}

// Weighted pick from a non-empty kinds table. Caller guarantees the array is
// non-empty (registry validator); a zero or negative total weight collapses to
// the first entry rather than throwing, since at runtime a misconfigured drop
// shouldn't crash the game loop.
export function pickDropKind(
  kinds: ReadonlyArray<{ readonly kind: PickupKind; readonly weight: number }>,
  random: () => number = Math.random,
): PickupKind {
  let total = 0;
  for (const entry of kinds) total += Math.max(0, entry.weight);
  if (total <= 0) return kinds[0].kind;
  const roll = random() * total;
  let acc = 0;
  for (const entry of kinds) {
    acc += Math.max(0, entry.weight);
    if (roll < acc) return entry.kind;
  }
  return kinds[kinds.length - 1].kind;
}

// Two-step roll: (1) chance gate, (2) weighted kind pick. Returns null when
// the chance roll fails so callers can branch on "did anything drop?" cleanly.
// Centralized here so chests and enemies share the exact same logic.
export function rollDrop(
  config: AnimatedEntityDropConfig,
  random: () => number = Math.random,
): PickupKind | null {
  if (random() * 100 >= config.chancePct) return null;
  return pickDropKind(config.kinds, random);
}

// World-spawned pickup (ammo or magic shard). Spawned by chests (on open-anim
// complete) and by enemies (on death-anim complete). Falls under gravity, lands
// on collision layers wired in GameScene, and is consumed by an Arcade overlap
// with the player. No interaction prompt — pickup is automatic on overlap.
export class AmmoDrop extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  private readonly kind: PickupKind;
  private readonly amount: number;
  private expiryTimer: Phaser.Time.TimerEvent | null = null;
  private mistEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  // Loiter state — populated only for magic orbs; null for ammo drops which
  // use plain physics-driven motion.
  private loiterAnchorX = 0;
  private loiterAnchorY = 0;
  private loiterPhase = 0;
  private loiterStartTime = 0;
  private loiterUpdateBound: ((time: number) => void) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, kind: PickupKind) {
    const choice = textureForKind(kind);
    if (!scene.textures.exists(choice.key)) {
      throw new Error(
        `AmmoDrop textures not loaded — expected key "${choice.key}". ` +
          'Did PreloadScene load this texture before construction?',
      );
    }
    // Magic orbs hover above the source rather than sitting on its surface,
    // so lift the spawn position before Sprite construction sets sprite/body
    // origin. Ammo drops keep the caller's coordinates exactly.
    const spawnY = kind === 'magic' ? y + MAGIC_ORB_SPAWN_Y_OFFSET_PX : y;
    super(scene, x, spawnY, choice.key, choice.frame);
    this.kind = kind;
    this.amount = amountForKind(kind);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(ENTITY_DEPTH);
    this.setScale(choice.scale);

    this.body.setSize(AMMO_DROP_BODY_WIDTH_PX, AMMO_DROP_BODY_HEIGHT_PX);

    if (kind === 'magic') {
      // Loitering orbs: gravity off, no velocity pop. Position is driven
      // directly by loiterUpdate each frame around the anchor point.
      this.body.setAllowGravity(false);
      this.setVelocity(0, 0);
      this.loiterAnchorX = x;
      this.loiterAnchorY = spawnY;
      this.loiterPhase = Math.random() * Math.PI * 2;
      this.loiterStartTime = scene.time.now;
      this.loiterUpdateBound = (time: number) => this.loiterUpdate(time);
      scene.events.on(Phaser.Scenes.Events.UPDATE, this.loiterUpdateBound);
    } else if (kind === 'coin') {
      // Coin burst: wider X/Y spread + lower drag than ammo drops so a
      // multi-coin payout (chest = 10, big chest = 20, boss = 50) scatters
      // into a visible spray instead of stacking on a single tile. Each
      // coin gets independent X and Y velocities so they take different
      // arcs and land at different spots.
      this.body.setAllowGravity(true);
      this.body.setDragX(COIN_DRAG_X);
      const vx = (Math.random() * 2 - 1) * COIN_SPAWN_VELOCITY_X_JITTER;
      const vy =
        COIN_SPAWN_VELOCITY_Y_MIN +
        Math.random() * (COIN_SPAWN_VELOCITY_Y_MAX - COIN_SPAWN_VELOCITY_Y_MIN);
      this.setVelocity(vx, vy);
    } else {
      // Ammo drops keep the falling/pop behavior. X drag damps the spawn
      // jitter so the drop settles where it lands rather than sliding along
      // the floor forever (Arcade Physics has no built-in surface friction);
      // Y drag stays zero so gravity remains uncontested.
      this.body.setAllowGravity(true);
      this.body.setDragX(AMMO_DROP_DRAG_X);
      // Initial pop: small upward velocity + uniform ±X jitter.
      const jitter =
        (Math.random() * 2 - 1) * AMMO_DROP_SPAWN_VELOCITY_X_JITTER;
      this.setVelocity(jitter, AMMO_DROP_SPAWN_VELOCITY_Y);
    }

    // Magic orbs get a discrete mist particle emitter that follows the sprite.
    // The orb itself is just a static black circle; the mist is what sells
    // "magical pickup" without resorting to a glow tween.
    if (kind === 'magic') {
      this.mistEmitter = scene.add.particles(0, 0, MIST_PARTICLE_TEXTURE_KEY, {
        // Spawn within a small circle centered on the orb so the mist appears
        // to surround rather than fountain from a single point.
        emitZone: {
          type: 'random',
          source: new Phaser.Geom.Circle(0, 0, MIST_PARTICLE_EMIT_RADIUS_PX),
          quantity: 0,
        },
        speed: { min: MIST_PARTICLE_SPEED_MIN, max: MIST_PARTICLE_SPEED_MAX },
        // Mostly upward (-90°) with a ±45° spread so wisps fan out as they rise.
        angle: { min: -135, max: -45 },
        lifespan: {
          min: MIST_PARTICLE_LIFESPAN_MIN_MS,
          max: MIST_PARTICLE_LIFESPAN_MAX_MS,
        },
        alpha: { start: MIST_PARTICLE_ALPHA_START, end: MIST_PARTICLE_ALPHA_END },
        scale: { start: MIST_PARTICLE_SCALE_START, end: MIST_PARTICLE_SCALE_END },
        frequency: MIST_PARTICLE_EMIT_FREQUENCY_MS,
        quantity: 1,
      });
      this.mistEmitter.setDepth(ENTITY_DEPTH);
      // Follow the orb so the mist stays anchored as the orb bounces on
      // landing. follow() tracks position each frame without per-tick code
      // here. Particles already in flight continue on their own trajectory.
      this.mistEmitter.startFollow(this);
    }

    this.expiryTimer = scene.time.delayedCall(AMMO_DROP_LIFETIME_MS, () => {
      this.expiryTimer = null;
      this.destroy();
    });

    // Mirrors the cleanup pattern Enemy uses for its hurt timer: cancel the
    // pending lifetime tick on any destroy path (pickup, HMR teardown, scene
    // shutdown) so the callback never fires against a destroyed body. The
    // mist emitter must also be destroyed explicitly — it's a separate
    // GameObject and Phaser doesn't auto-tear-down particle emitters when
    // their follow target is destroyed.
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.expiryTimer) {
        this.expiryTimer.remove(false);
        this.expiryTimer = null;
      }
      if (this.mistEmitter) {
        this.mistEmitter.stop();
        this.mistEmitter.destroy();
        this.mistEmitter = null;
      }
      if (this.loiterUpdateBound) {
        this.scene.events.off(
          Phaser.Scenes.Events.UPDATE,
          this.loiterUpdateBound,
        );
        this.loiterUpdateBound = null;
      }
    });
  }

  getKind(): PickupKind {
    return this.kind;
  }

  getAmount(): number {
    return this.amount;
  }

  // Sinusoidal hover: position = anchor + sin(t·ω + phase) · amplitude. X and
  // Y use different periods so the trajectory is an open Lissajous figure
  // rather than a straight line or perfect circle. Per-orb random phase
  // (set in constructor) decorrelates co-located orbs so they don't move in
  // lockstep. setPosition writes the sprite x/y; the physics body follows
  // via Arcade's per-frame body sync.
  private loiterUpdate(time: number): void {
    const elapsedSec = (time - this.loiterStartTime) / 1000;
    const xOmega = (2 * Math.PI) / (MAGIC_ORB_LOITER_X_PERIOD_MS / 1000);
    const yOmega = (2 * Math.PI) / (MAGIC_ORB_LOITER_Y_PERIOD_MS / 1000);
    const dx =
      Math.sin(elapsedSec * xOmega + this.loiterPhase) *
      MAGIC_ORB_LOITER_X_AMPLITUDE_PX;
    const dy =
      Math.sin(elapsedSec * yOmega + this.loiterPhase + Math.PI / 2) *
      MAGIC_ORB_LOITER_Y_AMPLITUDE_PX;
    this.setPosition(this.loiterAnchorX + dx, this.loiterAnchorY + dy);
  }
}
