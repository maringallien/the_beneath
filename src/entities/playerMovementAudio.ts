import type Phaser from 'phaser';
import { playOneShot, setPlayerStateSoundActive } from '../audio';

/**
 * @file entities/playerMovementAudio.ts
 * @description State-driven player movement sound loops (cloth-movement, surface-aware footsteps, land thud, falling whoosh) driven off one per-frame snapshot of player state. Owns the only cross-frame state the sounds need — the airborne apex (so a land's fall distance is measured from the true peak) and a continuous-fall timer (so the whoosh gates on sustained falls, not hops). A pure snapshot consumer that toggles audio slots, never touching the player or body geometry; the foot-surface probe is injected.
 * @module entities
 */

// LDtk IntGrid values; ground = pebble loop, bridge = metal-stairs loop
const INTGRID_GROUND_VALUE = 1;
const INTGRID_BRIDGE_VALUE = 2;

// ~3 tiles of descent from the apex needed to fire the land sound; small hops never reach it
const MIN_LAND_FALL_DISTANCE_PX = 48;

// the whoosh only swells after sustained free-fall; fades in slowly, out quickly on landing
const FALL_WHOOSH_DELAY_MS = 300;
const FALL_WHOOSH_FADE_IN_MS = 650;
const FALL_WHOOSH_FADE_OUT_MS = 180;

const LAND_SOUND_ID = 'player_jump_land';

// one-frame snapshot of player state for the sound predicates; computed after updateInner
export interface MovementAudioInput {
  readonly deltaMs: number;
  readonly flyMode: boolean;
  readonly dead: boolean;
  readonly hurtPlaying: boolean;
  readonly bodyMoving: boolean; // currentVisualState !== 'idle'
  readonly running: boolean; // currentVisualState === 'run'
  readonly onGround: boolean;
  readonly descending: boolean;
  readonly wallSliding: boolean;
  readonly y: number;
}

export class PlayerMovementAudio {
  private readonly scene: Phaser.Scene;
  // injected so this module doesn't need the body geometry — Player owns the probe offset
  private readonly probeFootSurface: () => number;

  // highest point of the current airborne arc; fall is measured from here, not the launch point
  private airborneApexY: number | null = null;
  // continuous free-fall time; reset when the fall breaks
  private fallWhooshElapsedMs = 0;

  constructor(scene: Phaser.Scene, probeFootSurface: () => number) {
    this.scene = scene;
    this.probeFootSurface = probeFootSurface;
  }

  /**
   * @function    update
   * @description Run all four movement-sound sub-updaters from this frame's snapshot.
   * @param   input  This frame's player-state snapshot.
   * @calledby src/entities/Player.ts → update, after its visual state is resolved
   * @calls    src/entities/playerMovementAudio.ts → updateMovementSound, updateFootstepsSound, updateLandingSound, updateFallingSound
   */
  update(input: MovementAudioInput): void {
    this.updateMovementSound(input);
    this.updateFootstepsSound(input);
    this.updateLandingSound(input);
    this.updateFallingSound(input);
  }

  /**
   * @function    updateMovementSound
   * @description Cloth-movement loop active when the body is animating (hurtPlaying keeps it on during take_hit); off entirely in fly mode.
   * @param   input  This frame's snapshot (reads flyMode / dead / bodyMoving / hurtPlaying).
   * @calledby src/entities/playerMovementAudio.ts → update
   * @calls    src/audio → setPlayerStateSoundActive
   */
  private updateMovementSound(input: MovementAudioInput): void {
    if (input.flyMode) {
      setPlayerStateSoundActive(this.scene, 'movement', false);
      return;
    }
    const active = !input.dead && (input.bodyMoving || input.hurtPlaying);
    setPlayerStateSoundActive(this.scene, 'movement', active);
  }

  /**
   * @function    updateFootstepsSound
   * @description Footstep loop for the tile underfoot — ground to pebbles, bridge to metal stairs, mutually exclusive; activates exactly one (or neither) slot.
   * @param   input  This frame's snapshot (reads flyMode / running / onGround).
   * @calledby src/entities/playerMovementAudio.ts → update
   * @calls    the injected foot-surface probe (only when running + grounded) and src/audio → setPlayerStateSoundActive
   */
  private updateFootstepsSound(input: MovementAudioInput): void {
    if (input.flyMode) {
      setPlayerStateSoundActive(this.scene, 'footstepsGround', false);
      setPlayerStateSoundActive(this.scene, 'footstepsBridge', false);
      return;
    }
    let tileValue = 0;
    if (input.running && input.onGround) {
      tileValue = this.probeFootSurface();
    }
    setPlayerStateSoundActive(
      this.scene,
      'footstepsGround',
      tileValue === INTGRID_GROUND_VALUE,
    );
    setPlayerStateSoundActive(
      this.scene,
      'footstepsBridge',
      tileValue === INTGRID_BRIDGE_VALUE,
    );
  }

  /**
   * @function    updateLandingSound
   * @description Fire the land thud when grounded after a fall of at least MIN_LAND_FALL_DISTANCE_PX, measured from the tracked airborne apex.
   * @param   input  This frame's snapshot (reads dead / onGround / y).
   * @calledby src/entities/playerMovementAudio.ts → update
   * @calls    src/audio → playOneShot when the fall distance from the apex clears the threshold
   */
  private updateLandingSound(input: MovementAudioInput): void {
    if (input.dead) {
      this.airborneApexY = null;
      return;
    }
    if (input.onGround) {
      if (this.airborneApexY !== null) {
        const fallDistance = input.y - this.airborneApexY;
        this.airborneApexY = null;
        if (fallDistance >= MIN_LAND_FALL_DISTANCE_PX) {
          playOneShot(this.scene, LAND_SOUND_ID);
        }
      }
    } else if (this.airborneApexY === null || input.y < this.airborneApexY) {
      this.airborneApexY = input.y; // first airborne frame or still ascending — raise the apex
    }
  }

  /**
   * @function    updateFallingSound
   * @description Swell the wind whoosh after FALL_WHOOSH_DELAY_MS of continuous descent (slow fade-in); fade out quickly on landing.
   * @param   input  This frame's snapshot (reads flyMode / onGround / descending / dead / wallSliding / deltaMs).
   * @calledby src/entities/playerMovementAudio.ts → update
   * @calls    src/audio → setPlayerStateSoundActive with the chosen fade duration
   */
  private updateFallingSound(input: MovementAudioInput): void {
    const falling =
      !input.flyMode &&
      !input.onGround &&
      input.descending &&
      !input.dead &&
      !input.wallSliding;

    if (falling) {
      this.fallWhooshElapsedMs += input.deltaMs;
    } else {
      this.fallWhooshElapsedMs = 0;
    }

    const active = this.fallWhooshElapsedMs >= FALL_WHOOSH_DELAY_MS;
    setPlayerStateSoundActive(
      this.scene,
      'falling',
      active,
      active ? FALL_WHOOSH_FADE_IN_MS : FALL_WHOOSH_FADE_OUT_MS,
    );
  }
}
