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

// Source-px lift above the sprite's vertical center for the E icon anchor.
// Unlike Chest/Save (which anchor at body.top because their physics body
// matches their visible silhouette), the mushroom merchant's 111×53 frame
// holds a tall character with a 48×27 floor-anchored body. body.top sits at
// the character's head/mushroom-cap level, which makes the icon visually
// float next to the head rather than over the figure. Anchoring at the
// sprite's vertical center, then lifting by this offset, centers the icon
// over the body of the character instead.
const ICON_BODY_CENTER_OFFSET_Y_PX = 4;

// Interactable merchant that sells magic orbs. Same shape as TechShop —
// see TechShop for the architectural rationale. The only differences are
// the identifier (driving sprite/body config from the registry) and the
// ShopKind passed to ShopScene via the event payload.
export class MushroomMerchant extends AnimatedEntity implements Interactable {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, MUSHROOM_MERCHANT_IDENTIFIER);
  }

  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.y - ICON_BODY_CENTER_OFFSET_Y_PX };
  }

  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  canInteract(): boolean {
    return true;
  }

  onInteract(): void {
    this.scene.events.emit(SHOP_REQUESTED_EVENT, { kind: MUSHROOM_MERCHANT_KIND });
  }
}
