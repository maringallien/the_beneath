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
  HEAL_CROSS_DROP_DISPLAY_SCALE,
  HEAL_CROSS_TEXTURE_KEY,
  HEAL_PICKUP_AMOUNT,
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

/**
 * AmmoDrop — a world-spawned auto-pickup (ammo, magic orb, heal cross, boss key,
 * or coin) plus the shared drop-roll helpers.
 *
 * One sprite class covers every loot kind: a per-kind texture/scale lookup and a
 * per-kind physics branch select between the three motion styles — magic orbs
 * hover (gravity off, sinusoidal loiter + a mist emitter), coins burst in a wide
 * scatter, and everything else falls-and-pops like ammo. Picked up by an Arcade
 * overlap with the player (automatic, no prompt). The module also owns the
 * weighted drop-roll (pickDropKind / rollDrop) so chests and enemies share one
 * loot path. Construction throws if the kind's texture wasn't preloaded.
 *
 * Inputs:  scene, spawn x/y, a PickupKind; drop configs + RNG for the roll
 *          helpers; tuning constants and PreloadScene-loaded textures.
 * Outputs: a physics sprite (self-registered, depth/scale/body set), a mist
 *          emitter for orbs, a lifetime self-destruct timer; PickupKind | null
 *          from the roll helpers.
 * @calledby chest open and enemy death, spawning whatever the drop roll selected.
 * @calls    Phaser sprite/physics/particle/timer construction and the scene
 *           update event (orb loiter); the roll helpers call only the RNG.
 */
// hud_ammo 6×3 grid: gun1=row0col0, gun2=row2col0; shared with the HUD so drop visuals match inventory icons
const HUD_AMMO_TEXTURE_KEY = 'hud_ammo';
const GUN1_FRAME = 0;
const GUN2_FRAME = 12;

interface TextureChoice {
  readonly key: string;
  readonly frame: number | undefined;
  readonly scale: number;
}

// texture, frame, and display scale for a pickup kind
function textureForKind(kind: PickupKind): TextureChoice {
  if (kind === 'gun1') {
    return { key: HUD_AMMO_TEXTURE_KEY, frame: GUN1_FRAME, scale: AMMO_DROP_DISPLAY_SCALE };
  }
  if (kind === 'gun2') {
    return { key: HUD_AMMO_TEXTURE_KEY, frame: GUN2_FRAME, scale: AMMO_DROP_DISPLAY_SCALE };
  }
  if (kind === 'magic') {
    return { key: MAGIC_ORB_TEXTURE_KEY, frame: undefined, scale: AMMO_DROP_DISPLAY_SCALE };
  }
  if (kind === 'heal') {
    return {
      key: HEAL_CROSS_TEXTURE_KEY,
      frame: undefined,
      scale: HEAL_CROSS_DROP_DISPLAY_SCALE,
    };
  }
  if (kind === 'key_storms' || kind === 'key_widow' || kind === 'key_heart') {
    // all boss keys share one texture; door-matching is by kind, not visual
    return { key: KEY_TEXTURE_KEY, frame: undefined, scale: KEY_DROP_DISPLAY_SCALE };
  }
  return { key: COIN_TEXTURE_KEY, frame: undefined, scale: COIN_DROP_DISPLAY_SCALE };
}

// inventory amount this drop adds on pickup
function amountForKind(kind: PickupKind): number {
  if (kind === 'gun1') return AMMO_PICKUP_GUN1_AMOUNT;
  if (kind === 'gun2') return AMMO_PICKUP_GUN2_AMOUNT;
  if (kind === 'magic') return MAGIC_PICKUP_AMOUNT;
  if (kind === 'heal') return HEAL_PICKUP_AMOUNT;
  if (kind === 'key_storms' || kind === 'key_widow' || kind === 'key_heart')
    return KEY_PICKUP_AMOUNT;
  return COIN_PICKUP_AMOUNT;
}

// weighted pick from a non-empty kinds table; zero-total collapses to first entry rather than throwing
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

// chancePct gate then a weighted kind pick; null when nothing drops
export function rollDrop(
  config: AnimatedEntityDropConfig,
  random: () => number = Math.random,
): PickupKind | null {
  if (random() * 100 >= config.chancePct) return null;
  return pickDropKind(config.kinds, random);
}

export class AmmoDrop extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  private readonly kind: PickupKind;
  private readonly amount: number;
  private expiryTimer: Phaser.Time.TimerEvent | null = null;
  private mistEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  // populated only for magic orbs; null for ammo/coin/etc which use physics
  private loiterAnchorX = 0;
  private loiterAnchorY = 0;
  private loiterPhase = 0;
  private loiterStartTime = 0;
  private loiterUpdateBound: ((time: number) => void) | null = null;

  // build the drop: magic orbs hover, coins scatter, everything else falls-and-pops
  constructor(scene: Phaser.Scene, x: number, y: number, kind: PickupKind) {
    const choice = textureForKind(kind);
    if (!scene.textures.exists(choice.key)) {
      throw new Error(
        `AmmoDrop textures not loaded — expected key "${choice.key}". ` +
          'Did PreloadScene load this texture before construction?',
      );
    }
    // orbs hover above the source; lift Y before super() so the body origin is correct
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
      // gravity off; loiterUpdate drives sinusoidal hover around the anchor
      this.body.setAllowGravity(false);
      this.setVelocity(0, 0);
      this.loiterAnchorX = x;
      this.loiterAnchorY = spawnY;
      this.loiterPhase = Math.random() * Math.PI * 2;
      this.loiterStartTime = scene.time.now;
      this.loiterUpdateBound = (time: number) => this.loiterUpdate(time);
      scene.events.on(Phaser.Scenes.Events.UPDATE, this.loiterUpdateBound);
    } else if (kind === 'coin') {
      // wider spread and lower drag so a multi-coin payout scatters into a spray
      this.body.setAllowGravity(true);
      this.body.setDragX(COIN_DRAG_X);
      const vx = (Math.random() * 2 - 1) * COIN_SPAWN_VELOCITY_X_JITTER;
      const vy =
        COIN_SPAWN_VELOCITY_Y_MIN +
        Math.random() * (COIN_SPAWN_VELOCITY_Y_MAX - COIN_SPAWN_VELOCITY_Y_MIN);
      this.setVelocity(vx, vy);
    } else {
      // falls and pops; X drag damps spawn jitter so the drop settles rather than sliding
      this.body.setAllowGravity(true);
      this.body.setDragX(AMMO_DROP_DRAG_X);
      const jitter =
        (Math.random() * 2 - 1) * AMMO_DROP_SPAWN_VELOCITY_X_JITTER;
      this.setVelocity(jitter, AMMO_DROP_SPAWN_VELOCITY_Y);
    }

    if (kind === 'magic') {
      this.mistEmitter = scene.add.particles(0, 0, MIST_PARTICLE_TEXTURE_KEY, {
        // emit within a small circle so the mist surrounds rather than fountains from a point
        emitZone: {
          type: 'random',
          source: new Phaser.Geom.Circle(0, 0, MIST_PARTICLE_EMIT_RADIUS_PX),
          quantity: 0,
        },
        speed: { min: MIST_PARTICLE_SPEED_MIN, max: MIST_PARTICLE_SPEED_MAX },
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
      // follow() tracks the orb each frame; in-flight particles continue on their own
      this.mistEmitter.startFollow(this);
    }

    this.expiryTimer = scene.time.delayedCall(AMMO_DROP_LIFETIME_MS, () => {
      this.expiryTimer = null;
      this.destroy();
    });

    // Phaser doesn't auto-tear-down the mist emitter when its follow target dies
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

  // Which pickup this drop grants (gun1/gun2/magic/heal/key_*/coin).
  getKind(): PickupKind {
    return this.kind;
  }

  // Inventory count this drop adds on pickup.
  getAmount(): number {
    return this.amount;
  }

  // sinusoidal Lissajous hover; the per-orb phase decorrelates co-located orbs
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
