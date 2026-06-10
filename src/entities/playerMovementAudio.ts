import type Phaser from 'phaser';
import { playOneShot, setPlayerStateSoundActive } from '../audio';

// IntGrid values from the LDtk source. Each maps to a distinct footstep
// surface — pebble loop for ground, metal-stairs loop for bridge. Mutually
// exclusive: only the slot matching the tile underfoot is active.
const INTGRID_GROUND_VALUE = 1;
const INTGRID_BRIDGE_VALUE = 2;

// Minimum vertical descent (pixels, from airborne apex to landing Y) before
// a ground contact fires the land sound. 3 tiles × 16 px = 48 px. Small
// hops, terrain flicker, and the spawn settle never accumulate enough drop
// from their peak to cross this — only meaningful falls do. Replaces an
// earlier airtime threshold which fired on small low jumps that nonetheless
// stayed airborne long enough.
const MIN_LAND_FALL_DISTANCE_PX = 48;

// Falling-whoosh tuning. The wind swell only starts once the player has been
// in a continuous free fall for FALL_WHOOSH_DELAY_MS — long enough that small
// hops and ledge steps (which land well under this) never trigger it. Once
// armed it fades IN over FADE_IN_MS (a slow swell) and, on landing, OUT over
// the much shorter FADE_OUT_MS so the wind doesn't linger over the land thud.
const FALL_WHOOSH_DELAY_MS = 300;
const FALL_WHOOSH_FADE_IN_MS = 650;
const FALL_WHOOSH_FADE_OUT_MS = 180;

const LAND_SOUND_ID = 'player_jump_land';

// One frame of the player state the sound predicates read, computed by
// Player.update() AFTER updateInner so every flag reflects the new
// currentVisualState / lockedAction, not last frame's. The expressions
// behind each flag live in Player.buildMovementAudioInput() and must keep
// matching the originals (e.g. `hurtPlaying` is lockedAction === 'hurt').
export interface MovementAudioInput {
  readonly deltaMs: number;
  readonly flyMode: boolean;
  readonly dead: boolean;
  readonly hurtPlaying: boolean;
  // currentVisualState !== 'idle'
  readonly bodyMoving: boolean;
  // currentVisualState === 'run'
  readonly running: boolean;
  readonly onGround: boolean;
  readonly descending: boolean;
  readonly wallSliding: boolean;
  readonly y: number;
}

// Drives the player's state-driven sound loops (cloth movement, footsteps,
// land thud, falling whoosh) off the per-frame input above. Owns the two
// pieces of cross-frame state the sounds need: the airborne apex (for the
// land-thud fall distance) and the continuous-fall timer (for the whoosh).
export class PlayerMovementAudio {
  private readonly scene: Phaser.Scene;
  // Queries the IntGrid value under the player's feet. Injected so this
  // module doesn't need the scene-cast or the body geometry — Player owns
  // the probe offset.
  private readonly probeFootSurface: () => number;

  // Highest point of the current airborne arc, or null while grounded —
  // the eventual fall is measured from the true peak, not the launch point.
  private airborneApexY: number | null = null;
  // Continuous free-fall time. Gates the falling whoosh behind
  // FALL_WHOOSH_DELAY_MS. Reset to 0 the moment the fall breaks (ground,
  // ascent, wall-slide, dead, or fly mode).
  private fallWhooshElapsedMs = 0;

  constructor(scene: Phaser.Scene, probeFootSurface: () => number) {
    this.scene = scene;
    this.probeFootSurface = probeFootSurface;
  }

  update(input: MovementAudioInput): void {
    this.updateMovementSound(input);
    this.updateFootstepsSound(input);
    this.updateLandingSound(input);
    this.updateFallingSound(input);
  }

  // Cloth-movement loop is active whenever the body anim is not idle and the
  // player isn't dead. The hurt branch is special-cased because take_hit
  // animates while currentVisualState is still 'idle' (hurt() sets the
  // visual state to idle before kicking the take_hit anim) — without the
  // carve-out the sound would cut on every hit.
  //
  // Fly mode is debug-only; cloth sound stays silent there even though
  // updateFlyMode sets currentVisualState='run' while moving.
  private updateMovementSound(input: MovementAudioInput): void {
    if (input.flyMode) {
      setPlayerStateSoundActive(this.scene, 'movement', false);
      return;
    }
    const active = !input.dead && (input.bodyMoving || input.hurtPlaying);
    setPlayerStateSoundActive(this.scene, 'movement', active);
  }

  // Footstep loops are active only while the player is actively running
  // (visualState 'run') AND grounded. The surface underfoot decides which
  // slot plays: ground tiles → pebbles, bridge tiles → metal stairs. The
  // two slots are mutually exclusive because the tile value can only be one
  // thing — when the player walks from ground onto bridge mid-stride, the
  // ground slot fades down while the bridge slot fades up, and the short
  // PLAYER_STATE_CROSSFADE_MS overlap masks the seam. Locked actions
  // (dash, roll, attack, block, climb, hurt, dead) cannot reach 'run'
  // visualState, so they're naturally excluded without explicit branches.
  // Fly mode silences both for the same reason as movement.
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

  // One-shot land sound on every airborne → grounded transition where the
  // descent from the airborne apex is at least MIN_LAND_FALL_DISTANCE_PX
  // (~3 tiles). Small hops, terrain flicker, and the spawn settle don't
  // accumulate enough vertical drop. Death blocks the sound: a dying body
  // catching the floor mid-knockback shouldn't punctuate the death anim.
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
      // First airborne frame OR the player kept ascending past last apex —
      // record/raise the apex so the eventual fall is measured from the
      // true peak, not the launch point.
      this.airborneApexY = input.y;
    }
  }

  // Soft wind whoosh that swells in while the player is in a sustained free
  // fall. A continuous-fall timer (fallWhooshElapsedMs) gates the sound behind
  // FALL_WHOOSH_DELAY_MS so brief hops and ledge steps never trigger it — only
  // falls long enough to build speed do. Excludes wall-slides (the scrape loop
  // already covers that descent), the rising half of a jump, death, and fly
  // mode. The slot fades IN slowly on activation and OUT quickly on landing
  // via the per-call fade durations passed to setPlayerStateSoundActive.
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
