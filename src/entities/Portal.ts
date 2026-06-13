import Phaser from 'phaser';
import {
  PORTAL_INTERACTION_RANGE_SQ,
  PORTAL_WARP_COMPLETE_EVENT,
  PORTAL_WARP_STARTED_EVENT,
  PORTAL_WARP_VANISH_EVENT,
  PORTAL_WARP_VANISH_FRAME,
} from '../constants';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';

// gap between body.top and the E-icon anchor, matching chest/save/door convention
const ICON_ANCHOR_GAP_PX = 2;

const PORTAL_IDENTIFIER = 'Portal_spawn';
const PORTAL_ANIM_WARP = 'warp';

/**
 * Portal — the game's victory exit, a hold-E interactable that plays the warp.
 *
 * Idles on AnimatedEntity's default loop until the player completes a hold-E
 * interaction, then plays the one-shot `warp` clip. The portal owns only the
 * animation and three scene-bus signals (warp started, mid-warp vanish frame,
 * warp complete); the scene owns the cross-cutting cutscene concerns —
 * player-freeze, body-hide, and the victory launch — driven off those signals.
 * Emitting events rather than reaching into the player/scene mirrors how Save
 * and the merchants are wired.
 *
 * Inputs:  scene, spawn x/y; hold-to-interact commits and Phaser animation events.
 * Outputs: drives its own `warp` animation and emits the three warp lifecycle
 *          events on the scene bus.
 * @calledby the gameplay scene — spawned at level load and driven by the
 *           hold-to-interact system and the victory flow it triggers.
 * @calls    the entity animation helper and the scene event emitter.
 */
export class Portal extends AnimatedEntity implements Interactable {
  // latched on interact so the warp plays exactly once and canInteract() flips false
  private warping = false;
  // guards the vanish signal so it fires only once per warp
  private vanishEmitted = false;

  // registers the per-frame vanish check and the completion win-signal
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, PORTAL_IDENTIFIER);
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      this.onAnimUpdate,
      this,
    );
    this.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.onAnimComplete,
      this,
    );
  }

  // Where the hold-E prompt floats: centred just above the portal's top edge.
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
  }

  // Squared player-distance within which the E prompt is offered.
  getInteractionRangeSq(): number {
    return PORTAL_INTERACTION_RANGE_SQ;
  }

  // The portal stops advertising the prompt once a warp has been committed.
  canInteract(): boolean {
    return !this.warping;
  }

  // starts the one-shot warp and signals the scene to begin the cutscene
  onInteract(): void {
    if (this.warping) return;
    this.warping = true;
    this.scene.events.emit(PORTAL_WARP_STARTED_EVENT);
    this.playLogical(PORTAL_ANIM_WARP);
  }

  // fires the vanish event once when the warp clip reaches the vanish frame (>=, not ===, for robustness)
  private onAnimUpdate(
    animation: Phaser.Animations.Animation,
    frame: Phaser.Animations.AnimationFrame,
  ): void {
    if (
      animation.key !== entityAnimFullKey(PORTAL_IDENTIFIER, PORTAL_ANIM_WARP)
    ) {
      return;
    }
    if (this.vanishEmitted) return;
    if (frame.index < PORTAL_WARP_VANISH_FRAME) return;
    this.vanishEmitted = true;
    this.scene.events.emit(PORTAL_WARP_VANISH_EVENT);
  }

  // emits the win event when the warp clip finishes; idle loops forever so it never reaches here
  private onAnimComplete(animation: Phaser.Animations.Animation): void {
    if (
      animation.key !== entityAnimFullKey(PORTAL_IDENTIFIER, PORTAL_ANIM_WARP)
    ) {
      return;
    }
    this.scene.events.emit(PORTAL_WARP_COMPLETE_EVENT);
  }
}
