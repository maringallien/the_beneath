import type Phaser from 'phaser';
import { playOneShot, setPlayerStateSoundActive } from '../audio';

/**
 * playerMovementAudio — the player's state-driven movement sound loops.
 *
 * Drives the cloth-movement loop, surface-aware footstep loops, the land thud,
 * and the falling whoosh off one per-frame snapshot of player state. Owns the
 * only two pieces of cross-frame state the sounds need: the airborne apex (so a
 * land's fall distance is measured from the true peak) and a continuous-fall
 * timer (so the whoosh gates on sustained falls, not brief hops). Pure
 * consumer of the snapshot — it reads flags and toggles audio slots, never
 * touching the player or the body geometry; the foot-surface probe is injected.
 *
 * Inputs:  a MovementAudioInput per frame plus an injected foot-surface probe.
 * Outputs: starts/stops the player state-sound slots and one-shot land sounds.
 * @calledby the player's per-frame update, after its visual state is resolved.
 * @calls    the shared player-state-sound activator and the one-shot player.
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

  // run all four movement-sound sub-updaters from this frame's snapshot
  update(input: MovementAudioInput): void {
    this.updateMovementSound(input);
    this.updateFootstepsSound(input);
    this.updateLandingSound(input);
    this.updateFallingSound(input);
  }

  // cloth-movement loop active when the body is animating; hurtPlaying keeps it on during take_hit
  private updateMovementSound(input: MovementAudioInput): void {
    if (input.flyMode) {
      setPlayerStateSoundActive(this.scene, 'movement', false);
      return;
    }
    const active = !input.dead && (input.bodyMoving || input.hurtPlaying);
    setPlayerStateSoundActive(this.scene, 'movement', active);
  }

  // footstep loop for the tile underfoot; ground→pebbles, bridge→metal stairs, mutually exclusive
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

  // fire the land thud when grounded after a fall of at least MIN_LAND_FALL_DISTANCE_PX
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

  // swell the wind whoosh after FALL_WHOOSH_DELAY_MS of continuous descent; fade out quickly on landing
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
