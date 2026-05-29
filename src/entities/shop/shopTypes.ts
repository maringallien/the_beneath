import {
  MAGIC_ORB_TEXTURE_KEY,
  SHOP_GUN1_GRANT_PER_PURCHASE,
  SHOP_GUN2_GRANT_PER_PURCHASE,
  SHOP_MAGIC_GRANT_PER_PURCHASE,
  SHOP_PRICE_GUN1_AMMO,
  SHOP_PRICE_GUN2_AMMO,
  SHOP_PRICE_MAGIC_ORB,
} from '../../constants';
import type { PickupKind } from '../Player';

// Which merchant the buyer is interacting with. Drives both the inventory
// selection (TECH_SHOP_ITEMS vs MUSHROOM_SHOP_ITEMS) and the title shown in
// ShopScene.
export type ShopKind = 'tech' | 'mushroom';

// A single line item in a shop. `pickupKind` and `grantAmount` are routed
// through Player.addPickup so the granting logic (and the per-kind clamp at
// MAX_*) lives in one place. `iconTextureKey` + optional `iconFrame` mirror
// the HUD wiring so the shop visually matches the player's existing UI: ammo
// items use the hud_ammo spritesheet, magic orbs use the procedural
// MAGIC_ORB_TEXTURE_KEY single-frame texture.
export interface ShopItem {
  readonly id: string;
  readonly pickupKind: PickupKind;
  readonly grantAmount: number;
  readonly price: number;
  readonly iconTextureKey: string;
  readonly iconFrame?: number;
  readonly label: string;
}

// hud_ammo spritesheet frame indices borrowed from PlayerHud (kept in sync
// with PlayerHud's GUN1_ICON_FRAME / GUN2_ICON_FRAME). Hard-coded here to
// avoid widening PlayerHud's public surface for a single-row HUD detail.
const HUD_AMMO_GUN1_FRAME = 0;
const HUD_AMMO_GUN2_FRAME = 12;

export const TECH_SHOP_ITEMS: ReadonlyArray<ShopItem> = [
  {
    id: 'tech_gun1',
    pickupKind: 'gun1',
    grantAmount: SHOP_GUN1_GRANT_PER_PURCHASE,
    price: SHOP_PRICE_GUN1_AMMO,
    iconTextureKey: 'hud_ammo',
    iconFrame: HUD_AMMO_GUN1_FRAME,
    label: 'Pistol Bullets',
  },
  {
    id: 'tech_gun2',
    pickupKind: 'gun2',
    grantAmount: SHOP_GUN2_GRANT_PER_PURCHASE,
    price: SHOP_PRICE_GUN2_AMMO,
    iconTextureKey: 'hud_ammo',
    iconFrame: HUD_AMMO_GUN2_FRAME,
    label: 'Shotgun Shells',
  },
];

export const MUSHROOM_SHOP_ITEMS: ReadonlyArray<ShopItem> = [
  {
    id: 'mushroom_orb',
    pickupKind: 'magic',
    grantAmount: SHOP_MAGIC_GRANT_PER_PURCHASE,
    price: SHOP_PRICE_MAGIC_ORB,
    iconTextureKey: MAGIC_ORB_TEXTURE_KEY,
    label: 'Magic Orb',
  },
];

// Title rendered at the top of the shop window per merchant kind.
export function shopTitleFor(kind: ShopKind): string {
  return kind === 'tech' ? 'TECH SHOP' : 'MUSHROOM MERCHANT';
}

export function shopItemsFor(kind: ShopKind): ReadonlyArray<ShopItem> {
  return kind === 'tech' ? TECH_SHOP_ITEMS : MUSHROOM_SHOP_ITEMS;
}
