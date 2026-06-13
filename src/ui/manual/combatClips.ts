import {
  AMMO_COST_PER_SHOT,
  GUN_OVERLAY_GRIP_ORIGIN_X,
  GUN_OVERLAY_PIVOT_OFFSET_X,
  GUN_OVERLAY_PIVOT_OFFSET_Y,
  MAGIC_COST_PER_SWING,
  PROJECTILE_GUN1_DAMAGE,
  PROJECTILE_GUN2_DAMAGE,
} from '../../constants';
import {
  getAnimationFrameInfo,
  gunOverlayAnimKey,
  magicAttackAnimKey,
} from '../../sprites/characterLoader';
import type { PreviewAttach, PreviewClipSpec } from '../animatedSpritePreview';

/**
 * combatClips — builds the manual's Combat-tab weapon demos.
 *
 * For each attack (sword combo, teleport strike, magic, the two guns) it produces
 * a looping animation (a list of clips for AnimatedSpritePreview) plus the
 * player-facing copy and key chips. Clip data is derived from the sprite registry
 * and combat constants — combo orders, gun grip offsets, and damage/cost numbers
 * all come from the same sources the gameplay uses, so the manual never drifts
 * from how the attacks really work.
 *
 * Inputs:  the sprite/animation registry and combat tuning constants.
 * Outputs: a list of WeaponDemo descriptors (data only; no scene/DOM side effects).
 * @calledby the manual overlay, when assembling the Combat tab.
 * @calls    the sprite-loader key/frame helpers that mirror the live attack setup.
 */

export type WeaponDemoId = 'sword' | 'teleport' | 'magic' | 'gun1' | 'gun2';

export interface WeaponDemo {
  readonly id: WeaponDemoId;
  readonly title: string;
  // Key chips shown next to the title (rendered like the Controls tab).
  readonly keys: ReadonlyArray<string>;
  // Separator drawn between key chips when the keys are pressed simultaneously
  // (e.g. "+" for Space + L-Click). Omitted when the keys aren't a combo.
  readonly keyJoiner?: string;
  readonly blurb: string;
  readonly clips: ReadonlyArray<PreviewClipSpec>;
}

// no hold between swings so the combo flows; brief rest only at the loop seam
const COMBO_HOLD = 0;
const COMBO_LOOP_HOLD = 6;

// read display scale from registry so gun overlay offsets match PlayerGun exactly
function bodyScale(): number {
  return getAnimationFrameInfo('gunslinger_body_idle')?.displayScale ?? 0.89;
}

const GUNSLINGER_BODY_IDLE_KEY = 'gunslinger_body_idle';

// gun overlay attachment mirroring PlayerGun.syncToOwner at a neutral aim angle
function gunAttach(): PreviewAttach {
  return {
    offsetX: GUN_OVERLAY_PIVOT_OFFSET_X,
    offsetY: GUN_OVERLAY_PIVOT_OFFSET_Y,
    originX: GUN_OVERLAY_GRIP_ORIGIN_X,
    originY: 0.5,
    scale: bodyScale(),
    rotation: 0,
  };
}

// One swing of the sword combo: a single full-size attack sheet, held briefly.
function swordSwing(step: number, hold: number): PreviewClipSpec {
  return {
    layers: [{ textureKey: `sword_master_attack${step}` }],
    holdFrames: hold,
  };
}

// one step of the magic combo — magicAttackAnimKey maps step→sheet in cast order
function magicSwing(step: number, hold: number): PreviewClipSpec {
  return {
    layers: [{ textureKey: magicAttackAnimKey(step) }],
    holdFrames: hold,
  };
}

// two-clip idle→fire loop for a gun preview, layering the overlay over the body like PlayerGun does
function gunClips(mode: 'gunslinger_gun1' | 'gunslinger_gun2'): PreviewClipSpec[] {
  const attach = gunAttach();
  const idle: PreviewClipSpec = {
    layers: [
      { textureKey: GUNSLINGER_BODY_IDLE_KEY },
      { textureKey: gunOverlayAnimKey(mode, 'idle'), attach },
    ],
    holdFrames: 9,
  };
  const fire: PreviewClipSpec = {
    layers: [
      { textureKey: GUNSLINGER_BODY_IDLE_KEY },
      { textureKey: gunOverlayAnimKey(mode, 'attack1'), attach },
    ],
    holdFrames: 1,
  };
  return [idle, fire];
}

// builds all Combat-tab weapon demos with clip loops, key chips, and copy drawn from combat constants
export function buildWeaponDemos(): ReadonlyArray<WeaponDemo> {
  // The click combo is the five regular swings (attack1–5). attack6 is NOT part
  // of it — it's the separate teleport strike below — so it's excluded here.
  const swordClips: PreviewClipSpec[] = [];
  for (let step = 1; step <= 5; step += 1) {
    swordClips.push(swordSwing(step, step === 5 ? COMBO_LOOP_HOLD : COMBO_HOLD));
  }

  // Teleport strike = sword attack6 (vanish → reappear → strike), triggered by
  // Space + L-Click together.
  const teleportClips: PreviewClipSpec[] = [swordSwing(6, COMBO_LOOP_HOLD)];

  const magicClips: PreviewClipSpec[] = [];
  for (let step = 1; step <= 5; step += 1) {
    magicClips.push(magicSwing(step, step === 5 ? COMBO_LOOP_HOLD : COMBO_HOLD));
  }

  return [
    {
      id: 'sword',
      title: 'Sword',
      keys: ['L-Click'],
      blurb:
        'Your starting weapon and the only one with no resource cost. Click to ' +
        'swing, and keep clicking to chain a five-hit combo.',
      clips: swordClips,
    },
    {
      id: 'teleport',
      title: 'Teleport Strike',
      keys: ['Space', 'L-Click'],
      keyJoiner: '+',
      blurb:
        'Press Space and Left-Click at the same time to vanish and reappear ' +
        'with a strike — a quick gap-closer or escape. Sword mode only.',
      clips: teleportClips,
    },
    {
      id: 'magic',
      title: 'Magic',
      keys: ['F', 'L-Click'],
      blurb:
        `Press F to toggle the magic stance on (press F again to turn it off). ` +
        `While it's on, click to unleash empowered sword casts that chain into a ` +
        `combo. Each cast spends ${MAGIC_COST_PER_SWING} magic orb ◆ — refill ` +
        `from drops and merchants.`,
      clips: magicClips,
    },
    {
      id: 'gun1',
      title: 'Gun 1 — Pistol',
      keys: ['Wheel', 'L-Click'],
      blurb:
        `Scroll the wheel to draw the pistol: fast, accurate shots for ` +
        `${PROJECTILE_GUN1_DAMAGE} damage. Each shot spends ` +
        `${AMMO_COST_PER_SHOT} pistol ammo.`,
      clips: gunClips('gunslinger_gun1'),
    },
    {
      id: 'gun2',
      title: 'Gun 2 — Shotgun',
      keys: ['Wheel', 'L-Click'],
      blurb:
        `Scroll to the shotgun: a slower, heavier hitter for ` +
        `${PROJECTILE_GUN2_DAMAGE} damage at close range. Each shot spends ` +
        `${AMMO_COST_PER_SHOT} shotgun ammo.`,
      clips: gunClips('gunslinger_gun2'),
    },
  ];
}
