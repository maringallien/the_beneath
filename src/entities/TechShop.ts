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

// Source-px shift of the E icon anchor relative to the sprite's vertical
// center (origin is 0.5, so this.y is the center of the 108×108 frame). The
// tech shop is a tall silhouette with a 48×48 floor-anchored body in the lower
// half, so centering the icon left it floating high over empty sprite. A
// negative value pushes the anchor BELOW center (Phaser world-Y grows
// downward) so the icon sits down over the shop body. Combined with the global
// INTERACTION_ICON_OFFSET_Y_PX (6) the icon lands ~22px below center.
const ICON_BODY_CENTER_OFFSET_Y_PX = -28;

// Source-px horizontal shift of the E icon anchor from the sprite's center
// (negative = left; Phaser world-X grows rightward). The 48×48 body is
// centered on this.x, so this nudges the icon off-center. Shops are static and
// never flip, so a fixed offset stays correct.
const ICON_OFFSET_X_PX = -8;

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
    return {
      x: this.x + ICON_OFFSET_X_PX,
      y: this.y - ICON_BODY_CENTER_OFFSET_Y_PX,
    };
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
