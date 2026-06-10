import {
  getAnimationNaturalDurationMs,
  getAnimationStage,
  gunOverlayAnimKey,
} from '../sprites/characterLoader';
import {
  GUNSLINGER_GUN1_FIRE_RATE_MULTIPLIER,
  PROJECTILE_GUN1_DAMAGE,
  PROJECTILE_GUN1_SPEED,
  PROJECTILE_GUN2_DAMAGE,
  PROJECTILE_GUN2_SPEED,
} from '../constants';

export interface ProjectileFireConfig {
  // Overlay anim key (the gun sprite). The body has no attack1 anymore —
  // firing is overlay-only, so the lifecycle (fire-frame trigger, complete
  // event) is sourced from the overlay's animation events.
  readonly overlayKey: string;
  readonly fireFrame: number;
  readonly speed: number;
  readonly damage: number;
  readonly mode: 'gunslinger_gun1' | 'gunslinger_gun2';
  // Overlay play duration (ms). Undefined = use the registry's natural
  // duration. Set for gun1 to apply the fire-rate multiplier, which also
  // shortens the locked-attack window so the player can fire again sooner.
  readonly overlayDurationMs?: number;
}

export function buildProjectileFireConfigs(): ReadonlyMap<
  'gunslinger_gun1' | 'gunslinger_gun2',
  ProjectileFireConfig
> {
  const map = new Map<
    'gunslinger_gun1' | 'gunslinger_gun2',
    ProjectileFireConfig
  >();
  // Firing is overlay-only — the gun sprite's attack1 is the visible gunshot,
  // so its "fire" stage frame index drives projectile spawn timing and its
  // animation-complete event ends the locked-attack window.
  const gun1OverlayKey = gunOverlayAnimKey('gunslinger_gun1', 'attack1');
  const gun2OverlayKey = gunOverlayAnimKey('gunslinger_gun2', 'attack1');
  const gun1Stage = getAnimationStage(gun1OverlayKey, 'fire');
  const gun2Stage = getAnimationStage(gun2OverlayKey, 'fire');
  if (!gun1Stage || !gun2Stage) {
    throw new Error(
      `Missing "fire" stage on gunslinger overlay attack1. gun1=${gun1Stage}, gun2=${gun2Stage}. ` +
        'Did the animation registry get out of sync?',
    );
  }
  const gun1OverlayNatural = getAnimationNaturalDurationMs(gun1OverlayKey);
  if (gun1OverlayNatural == null) {
    throw new Error('Missing natural duration for gun1 overlay attack1');
  }
  map.set('gunslinger_gun1', {
    overlayKey: gun1OverlayKey,
    fireFrame: gun1Stage.startFrame,
    speed: PROJECTILE_GUN1_SPEED,
    damage: PROJECTILE_GUN1_DAMAGE,
    mode: 'gunslinger_gun1',
    overlayDurationMs: gun1OverlayNatural / GUNSLINGER_GUN1_FIRE_RATE_MULTIPLIER,
  });
  map.set('gunslinger_gun2', {
    overlayKey: gun2OverlayKey,
    fireFrame: gun2Stage.startFrame,
    speed: PROJECTILE_GUN2_SPEED,
    damage: PROJECTILE_GUN2_DAMAGE,
    mode: 'gunslinger_gun2',
  });
  return map;
}
