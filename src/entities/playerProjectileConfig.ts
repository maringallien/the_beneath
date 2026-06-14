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
 * @file entities/playerProjectileConfig.ts
 * @description Per-gun-mode firing parameters baked once at boot from the animation registry — firing is overlay-only, so the gun sprite's attack1 "fire" stage frame drives projectile-spawn timing and its complete event ends the locked-attack window (the body has no attack1); throws if the expected "fire" stage or natural duration is missing.
 * @module entities
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

/**
 * @function    buildProjectileFireConfigs
 * @description Build the immutable mode-to-fire-config map from the animation registry; gun1 carries the fire-rate-adjusted overlay duration, gun2 plays at natural speed.
 * @returns a frozen map keyed by firing mode; throws if the overlays' "fire" stage or gun1 natural duration is missing.
 * @calledby src/entities/Player.ts → constructor, precomputing fire configs at spawn
 * @calls    the character-loader queries for overlay anim keys, stages, and durations
 */
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
