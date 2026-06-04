import {
  INTERACTION_RANGE_SQ,
  SHOP_REQUESTED_EVENT,
} from '../constants';
import Phaser from 'phaser';
import { AnimatedEntity } from './AnimatedEntity';
import type { Interactable } from './Interactable';
import type { ShopKind } from './shop/shopTypes';

const TECH_SHOP_IDENTIFIER = 'Tech_shop_spawn';
const TECH_SHOP_KIND: ShopKind = 'tech';

// Source-px lift above the sprite's vertical center for the E icon anchor.
// The 108×108 frame holds a tall shop with a 48×48 floor-anchored body, so
// body.top sits in the lower-middle of the silhouette rather than its top.
// Anchor at the sprite's vertical center (like MushroomMerchant) so the icon
// sits centered on the shop instead of floating low.
const ICON_BODY_CENTER_OFFSET_Y_PX = 4;

// Interactable merchant that sells ammo. Implements the Interactable contract
// in the same shape as Save/Chest: the InteractionManager owns the proximity
// scan, hold-E timing, and icon rendering. On commit, this entity emits
// SHOP_REQUESTED_EVENT on the scene event bus with its ShopKind — GameScene
// listens and launches ShopScene with the matching inventory.
export class TechShop extends AnimatedEntity implements Interactable {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TECH_SHOP_IDENTIFIER);
  }

  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.y - ICON_BODY_CENTER_OFFSET_Y_PX };
  }

  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  // Merchants are reusable — the player can re-open the shop indefinitely.
  canInteract(): boolean {
    return true;
  }

  onInteract(): void {
    this.scene.events.emit(SHOP_REQUESTED_EVENT, { kind: TECH_SHOP_KIND });
  }
}
