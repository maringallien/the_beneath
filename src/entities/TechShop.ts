import {
  INTERACTION_RANGE_SQ,
  SHOP_REQUESTED_EVENT,
} from '../constants';
import Phaser from 'phaser';
import { AnimatedEntity } from './AnimatedEntity';
import type { Interactable } from './Interactable';
import type { ShopKind } from './shop/shopTypes';

/**
 * @file entities/TechShop.ts
 * @description Interactable ammo merchant that, on a completed hold-E, emits SHOP_REQUESTED_EVENT tagged 'tech' so the scene opens the matching shop overlay. Always re-openable; the icon anchor is nudged left and down to sit over the body rather than the sprite's tall empty top. The actual buying lives in the shop overlay, reached via the event.
 * @module entities
 */

const TECH_SHOP_IDENTIFIER = 'Tech_shop_spawn';
const TECH_SHOP_KIND: ShopKind = 'tech';

// Negative = pushes anchor below sprite center; keeps icon over the body, not the tall empty top.
const ICON_BODY_CENTER_OFFSET_Y_PX = -28;

// Nudges the icon slightly left of the sprite center.
const ICON_OFFSET_X_PX = -8;

// Interactable ammo shopkeeper — emits SHOP_REQUESTED_EVENT tagged 'tech' on hold-E.
export class TechShop extends AnimatedEntity implements Interactable {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TECH_SHOP_IDENTIFIER);
  }

  /** Icon anchor: nudged left and pushed down over the shop body. */
  getInteractionAnchor(): { x: number; y: number } {
    return {
      x: this.x + ICON_OFFSET_X_PX,
      y: this.y - ICON_BODY_CENTER_OFFSET_Y_PX,
    };
  }

  /** Squared player-distance within which the E prompt is offered. */
  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  /** Always true — shop can be re-opened indefinitely. */
  canInteract(): boolean {
    return true;
  }

  /**
   * @function    onInteract
   * @description Emits the shop-open request tagged 'tech' so the scene opens the ammo shop overlay.
   * @calledby src/entities/InteractionManager.ts → when the player completes a hold
   * @calls    the scene event bus (SHOP_REQUESTED_EVENT)
   */
  onInteract(): void {
    this.scene.events.emit(SHOP_REQUESTED_EVENT, { kind: TECH_SHOP_KIND });
  }
}
