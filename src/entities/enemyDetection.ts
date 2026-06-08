// Pure stealth/detection logic, decoupled from Phaser and from the Enemy state
// machine. Enemy.updateAlertState wires these together with the live scene: it
// supplies facing + the on-screen and line-of-sight tests, and feeds the result
// back into the existing chase/aggro code.
//
// The model layers a three-state "alert" machine on top of the enemy's motion
// states (idle/loiter/chase/attack/...):
//   - normal:        unaware, default behaviour. (HUD corners faint white)
//   - investigating: has spotted the player and is reacting/hunting — stops,
//                    flashes a yellow "?", then rushes to the last-seen spot and
//                    searches. (HUD corners yellow)
//   - conflict:      actively engaging — attacking / trading blows. Flashes a
//                    red "!". (HUD corners red)

export type AlertState = 'normal' | 'investigating' | 'conflict';

// Numeric escalation used to aggregate across enemies (highest wins) and to
// drive the HUD corner brackets: 0 → faint white, 1 → yellow, 2 → red.
export function alertLevel(state: AlertState): 0 | 1 | 2 {
  switch (state) {
    case 'normal':
      return 0;
    case 'investigating':
      return 1;
    case 'conflict':
      return 2;
  }
}

// Is the player inside this enemy's forward vision cone? Enemies face left or
// right only (facing is +1 right, -1 left), so the cone is a frontal wedge:
//   - beyond `rangePx`            → never (out of sight range)
//   - within `nearRadiusPx`       → always (point-blank: you can't stand on its
//                                   head undetected, regardless of facing)
//   - otherwise                   → only when the angle between the facing
//                                   direction and the line to the player is
//                                   within ±halfAngle.
//
// dx is (player.x - enemy.x); dist is hypot(dx, dy), passed in so the caller
// doesn't recompute. The vertical delta is folded into dist, so the cosine test
// needs only dx. Geometry only — the caller AND-combines with a line-of-sight
// check so a wall between them still hides the player.
export function isInDetectionCone(
  dx: number,
  dist: number,
  facing: 1 | -1,
  rangePx: number,
  halfAngleRad: number,
  nearRadiusPx: number,
): boolean {
  if (dist > rangePx) return false;
  if (dist <= nearRadiusPx) return true;
  // dist > nearRadiusPx >= 0, so dist > 0 — safe to divide. cos(angle to player)
  // = (toPlayer · facingUnit) / dist, and facingUnit is (facing, 0), so the dot
  // product is dx * facing. Inside the cone when that cosine is at least the
  // cone's edge cosine.
  const cosToPlayer = (dx * facing) / dist;
  return cosToPlayer >= Math.cos(halfAngleRad);
}

// Inputs to classifyAlert — booleans the caller has already resolved against the
// live scene, keeping this function pure.
export interface AlertInputs {
  // The active-combat window is open (the enemy attacked / landed contact damage
  // recently) or it's mid-swing — unambiguously engaging.
  readonly inConflict: boolean;
  // The enemy has detected the player and the aggro window hasn't lapsed.
  readonly aware: boolean;
}

// Resolves the alert state from this frame's signals. Conflict outranks mere
// awareness, which outranks unaware.
export function classifyAlert(i: AlertInputs): AlertState {
  if (i.inConflict) return 'conflict';
  if (i.aware) return 'investigating';
  return 'normal';
}
