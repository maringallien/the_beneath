/**
 * @file entities/enemyDetection.ts
 * @description Pure stealth/detection logic, decoupled from Phaser and the Enemy state machine — a three-state alert machine layered over the motion states: normal (unaware; HUD corners faint white), investigating (spotted the player: stops, flashes a yellow "?", then rushes the last-seen spot and searches; HUD corners yellow), conflict (engaging: flashes a red "!"; HUD corners red). Leaf geometry and lookup tables only — no mutation, no scene access; the enemy wires these to the live scene and feeds results back into its chase/aggro code.
 * @module entities
 */

export type AlertState = 'normal' | 'investigating' | 'conflict';

/**
 * @function    alertLevel
 * @description Maps alert state to 0/1/2 for HUD colour aggregation (highest enemy wins).
 * @param   state  Alert state to rank.
 * @returns 0 (normal), 1 (investigating), or 2 (conflict).
 * @calledby src/entities/Enemy.ts → the HUD corner-colour aggregation, ranking each enemy's alert this frame
 * @calls    —
 */
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

/**
 * @function    isInDetectionCone
 * @description True if the player is inside the enemy's forward vision cone; caller AND-gates with LOS for walls.
 * @param   dx            Signed x to player (px).
 * @param   dist          Distance to player (px).
 * @param   facing        Enemy facing: 1 = right, -1 = left.
 * @param   rangePx       Cone reach.
 * @param   halfAngleRad  Cone half-angle.
 * @param   nearRadiusPx  Always-spotted bubble around the enemy.
 * @returns false beyond range, true within the near bubble, else true when the facing-to-player angle is within the half-angle.
 * @calledby src/entities/Enemy.ts → the per-frame detection check, before its own wall LOS test
 * @calls    —
 */
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

/**
 * @function    classifyAlert
 * @description Picks the alert state from this frame's signals, priority conflict > aware > normal.
 * @param   i  Pre-resolved inConflict / aware booleans for this frame.
 * @returns the AlertState for this frame.
 * @calledby src/entities/Enemy.ts → updateAlertState, after resolving the input booleans
 * @calls    —
 */
export function classifyAlert(i: AlertInputs): AlertState {
  if (i.inConflict) return 'conflict';
  if (i.aware) return 'investigating';
  return 'normal';
}
