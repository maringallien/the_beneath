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

// Source-px gap between the shop's body.top and the E icon anchor point.
// Mirrors Chest/Save so the icon hovers a touch above the silhouette.
const ICON_ANCHOR_GAP_PX = 2;

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
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
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
