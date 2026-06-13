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

/**
 * playerProjectileConfig — per-gun-mode firing parameters, resolved from the
 * animation registry once at boot.
 *
 * Firing is overlay-only: the gun sprite's attack1 clip is the visible gunshot,
 * so its "fire" stage frame index drives projectile-spawn timing and its
 * animation-complete event ends the locked-attack window (the body has no
 * attack1). This module reads those registry stages plus the projectile tuning
 * constants and bakes them into one immutable map keyed by firing mode.
 *
 * Inputs:  the gun-overlay animation registry (stage frames + natural duration)
 *          and the projectile speed/damage/fire-rate constants.
 * Outputs: a frozen mode → ProjectileFireConfig map; throws if the registry is
 *          missing the expected "fire" stage or natural duration.
 * @calledby the player firing system at construction, to precompute fire configs.
 * @calls    the character-loader registry queries for overlay stages/durations.
 */

export interface ProjectileFireConfig {
  // Gun overlay anim key (firing is overlay-only; body has no attack1).
  readonly overlayKey: string;
  // 0-based frame index at which the projectile spawns.
  readonly fireFrame: number;
  readonly speed: number;
  readonly damage: number;
  readonly mode: 'gunslinger_gun1' | 'gunslinger_gun2';
  // Override play duration (ms); set for gun1 to apply the fire-rate multiplier.
  readonly overlayDurationMs?: number;
}

// Builds the immutable mode → fire-config map from the animation registry; throws if the "fire" stage is missing.
export function buildProjectileFireConfigs(): ReadonlyMap<
  'gunslinger_gun1' | 'gunslinger_gun2',
  ProjectileFireConfig
> {
  const map = new Map<
    'gunslinger_gun1' | 'gunslinger_gun2',
    ProjectileFireConfig
  >();
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
