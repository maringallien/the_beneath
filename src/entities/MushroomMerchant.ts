import {
  INTERACTION_RANGE_SQ,
  SHOP_REQUESTED_EVENT,
} from '../constants';
import Phaser from 'phaser';
import { AnimatedEntity } from './AnimatedEntity';
import type { Interactable } from './Interactable';
import type { ShopKind } from './shop/shopTypes';

const MUSHROOM_MERCHANT_IDENTIFIER = 'Mushroom_merchant_spawn';
const MUSHROOM_MERCHANT_KIND: ShopKind = 'mushroom';

// Lift above sprite center for the E icon — body.top sits at cap level so we anchor to center instead.
const ICON_BODY_CENTER_OFFSET_Y_PX = 4;

// Interactable magic-orb shopkeeper — emits SHOP_REQUESTED_EVENT tagged 'mushroom' on hold-E.
export class MushroomMerchant extends AnimatedEntity implements Interactable {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, MUSHROOM_MERCHANT_IDENTIFIER);
  }

  // Icon anchor: lifted above sprite center so it sits over the figure.
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.y - ICON_BODY_CENTER_OFFSET_Y_PX };
  }

  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  // Always true — shop can be re-opened indefinitely.
  canInteract(): boolean {
    return true;
  }

  onInteract(): void {
    this.scene.events.emit(SHOP_REQUESTED_EVENT, { kind: MUSHROOM_MERCHANT_KIND });
  }
}
