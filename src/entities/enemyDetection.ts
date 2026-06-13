/**
 * enemyDetection — pure stealth/detection logic, decoupled from Phaser and from
 * the Enemy state machine.
 *
 * Layers a three-state "alert" machine on top of the enemy's motion states
 * (idle/loiter/chase/attack/...):
 *   - normal:        unaware, default behaviour. (HUD corners faint white)
 *   - investigating: has spotted the player and is reacting/hunting — stops,
 *                    flashes a yellow "?", then rushes to the last-seen spot and
 *                    searches. (HUD corners yellow)
 *   - conflict:      actively engaging — attacking / trading blows. Flashes a
 *                    red "!". (HUD corners red)
 * These free functions stay pure: the enemy wires them to the live scene,
 * supplying facing plus the on-screen and line-of-sight tests, and feeds the
 * result back into the existing chase/aggro code.
 *
 * Inputs:  geometry (dx/dist/facing), cone tuning, and pre-resolved boolean
 *          signals (in-conflict, aware) from the caller.
 * Outputs: an AlertState / numeric alert level / cone-membership boolean — no
 *          mutation, no scene access.
 * @calledby the enemy's per-frame alert update, classifying this frame's signals.
 * @calls    nothing — leaf geometry and lookup tables only.
 */

export type AlertState = 'normal' | 'investigating' | 'conflict';

// maps alert state to 0/1/2 for HUD colour aggregation (highest enemy wins)
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

// true if the player is inside the enemy's forward vision cone; caller AND-gates with LOS for walls
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
  // cosine of the angle between facing and the line to player; inside cone when >= cos(halfAngle)
  const cosToPlayer = (dx * facing) / dist;
  return cosToPlayer >= Math.cos(halfAngleRad);
}

// pre-resolved booleans the caller passes in, keeping classifyAlert pure
export interface AlertInputs {
  // combat window open (attacked recently or mid-swing)
  readonly inConflict: boolean;
  // detected player and aggro window hasn't lapsed
  readonly aware: boolean;
}

// conflict > aware > normal
export function classifyAlert(i: AlertInputs): AlertState {
  if (i.inConflict) return 'conflict';
  if (i.aware) return 'investigating';
  return 'normal';
}
