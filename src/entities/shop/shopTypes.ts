import {
  AMMO_UPGRADE_LEVELS,
  AMMO_UPGRADE_PRICES,
  GUN1_CAPACITY_UPGRADE_STEP,
  GUN2_CAPACITY_UPGRADE_STEP,
  HEAL_CROSS_TEXTURE_KEY,
  MAGIC_CAPACITY_UPGRADE_STEP,
  MAGIC_ORB_TEXTURE_KEY,
  MAGIC_UPGRADE_LEVELS,
  MAGIC_UPGRADE_PRICES,
  SHOP_GUN1_GRANT_PER_PURCHASE,
  SHOP_GUN2_GRANT_PER_PURCHASE,
  SHOP_HEAL_GRANT_PER_PURCHASE,
  SHOP_MAGIC_GRANT_PER_PURCHASE,
  SHOP_PRICE_GUN1_AMMO,
  SHOP_PRICE_GUN2_AMMO,
  SHOP_PRICE_HEAL_ITEM,
  SHOP_PRICE_MAGIC_ORB,
} from '../../constants';
import { upgradeId, type UpgradeType } from '../../state/runProgress';
import type { PickupKind } from '../Player';

// Which merchant the buyer is interacting with. Drives both the inventory
// selection (TECH_SHOP_ITEMS vs MUSHROOM_SHOP_ITEMS) and the title shown in
// ShopScene.
export type ShopKind = 'tech' | 'mushroom';

// Shop line items come in two shapes, discriminated by `kind`:
//  - 'resource': a repeatable restock (ammo, orbs, heal kits). `pickupKind` +
//    `grantAmount` route through Player.addPickup so the granting logic (and
//    the per-kind clamp at the current max) lives in one place.
//  - 'upgrade': a one-time capacity upgrade that permanently raises a carry
//    cap. Identified by a per-shop `id` (see upgradeId) recorded in runProgress;
//    buying it raises Player.getMax* rather than granting a countable resource,
//    and a shop refuses to re-sell its own upgrade once owned.
// `iconTextureKey` + optional `iconFrame` mirror the HUD wiring so the shop
// visually matches the player's existing UI.
interface ShopItemBase {
  readonly id: string;
  readonly price: number;
  readonly iconTextureKey: string;
  readonly iconFrame?: number;
  readonly label: string;
}

export interface ResourceShopItem extends ShopItemBase {
  readonly kind: 'resource';
  readonly pickupKind: PickupKind;
  readonly grantAmount: number;
}

export interface UpgradeShopItem extends ShopItemBase {
  readonly kind: 'upgrade';
  readonly upgradeType: UpgradeType;
  // Short line under the label describing the cap increase ("+6 pistol / +4
  // shotgun max"). Resource items derive their detail from grantAmount instead.
  readonly detail: string;
}

export type ShopItem = ResourceShopItem | UpgradeShopItem;

// hud_ammo spritesheet frame indices borrowed from PlayerHud (kept in sync
// with PlayerHud's GUN1_ICON_FRAME / GUN2_ICON_FRAME). Hard-coded here to
// avoid widening PlayerHud's public surface for a single-row HUD detail.
const HUD_AMMO_GUN1_FRAME = 0;
const HUD_AMMO_GUN2_FRAME = 12;

const TECH_SHOP_ITEMS: ReadonlyArray<ResourceShopItem> = [
  {
    kind: 'resource',
    id: 'tech_gun1',
    pickupKind: 'gun1',
    grantAmount: SHOP_GUN1_GRANT_PER_PURCHASE,
    price: SHOP_PRICE_GUN1_AMMO,
    iconTextureKey: 'hud_ammo',
    iconFrame: HUD_AMMO_GUN1_FRAME,
    label: 'Pistol Bullets',
  },
  {
    kind: 'resource',
    id: 'tech_gun2',
    pickupKind: 'gun2',
    grantAmount: SHOP_GUN2_GRANT_PER_PURCHASE,
    price: SHOP_PRICE_GUN2_AMMO,
    iconTextureKey: 'hud_ammo',
    iconFrame: HUD_AMMO_GUN2_FRAME,
    label: 'Shotgun Shells',
  },
];

const MUSHROOM_SHOP_ITEMS: ReadonlyArray<ResourceShopItem> = [
  {
    kind: 'resource',
    id: 'mushroom_orb',
    pickupKind: 'magic',
    grantAmount: SHOP_MAGIC_GRANT_PER_PURCHASE,
    price: SHOP_PRICE_MAGIC_ORB,
    iconTextureKey: MAGIC_ORB_TEXTURE_KEY,
    label: 'Mana Crystal',
  },
  {
    kind: 'resource',
    id: 'mushroom_heal',
    pickupKind: 'heal',
    grantAmount: SHOP_HEAL_GRANT_PER_PURCHASE,
    price: SHOP_PRICE_HEAL_ITEM,
    iconTextureKey: HEAL_CROSS_TEXTURE_KEY,
    label: 'Med Kit',
  },
];

// The tech shop's Ammo Storage upgrade for the level at `tierIndex` (its index
// in AMMO_UPGRADE_LEVELS, which also picks the price). One purchase widens both
// gun caps, so the detail names both increments.
function ammoUpgradeItem(levelId: string, tierIndex: number): UpgradeShopItem {
  return {
    kind: 'upgrade',
    id: upgradeId('ammo', levelId),
    upgradeType: 'ammo',
    price: AMMO_UPGRADE_PRICES[tierIndex],
    iconTextureKey: 'hud_ammo',
    iconFrame: HUD_AMMO_GUN1_FRAME,
    label: 'Ammo Storage',
    detail: `+${GUN1_CAPACITY_UPGRADE_STEP} pistol / +${GUN2_CAPACITY_UPGRADE_STEP} shotgun max`,
  };
}

// The mushroom merchant's Orb Pouch upgrade for the level at `tierIndex`.
function magicUpgradeItem(levelId: string, tierIndex: number): UpgradeShopItem {
  return {
    kind: 'upgrade',
    id: upgradeId('magic', levelId),
    upgradeType: 'magic',
    price: MAGIC_UPGRADE_PRICES[tierIndex],
    iconTextureKey: MAGIC_ORB_TEXTURE_KEY,
    label: 'Crystal Pouch',
    detail: `+${MAGIC_CAPACITY_UPGRADE_STEP} crystal max`,
  };
}

// The capacity upgrade this shop kind sells in `levelId`, or null when the
// level's merchant of that kind sells no upgrade (every level but 9/11/18).
function upgradeItemFor(
  kind: ShopKind,
  levelId: string | null,
): UpgradeShopItem | null {
  if (!levelId) return null;
  if (kind === 'tech') {
    const tier = AMMO_UPGRADE_LEVELS.indexOf(levelId);
    return tier >= 0 ? ammoUpgradeItem(levelId, tier) : null;
  }
  const tier = MAGIC_UPGRADE_LEVELS.indexOf(levelId);
  return tier >= 0 ? magicUpgradeItem(levelId, tier) : null;
}

// Title rendered at the top of the shop window per merchant kind.
export function shopTitleFor(kind: ShopKind): string {
  return kind === 'tech' ? 'TECH SHOP' : 'MUSHROOM MERCHANT';
}

// Inventory for a shop: the kind's standard restock items, plus this level's
// capacity upgrade if its merchant sells one. `levelId` is the LDtk identifier
// of the level the player is standing in (GameScene.getCurrentLevelId), which
// uniquely identifies the merchant since each upgrade level holds one tech shop
// and one mushroom merchant.
export function shopItemsFor(
  kind: ShopKind,
  levelId: string | null,
): ReadonlyArray<ShopItem> {
  const base = kind === 'tech' ? TECH_SHOP_ITEMS : MUSHROOM_SHOP_ITEMS;
  const upgrade = upgradeItemFor(kind, levelId);
  return upgrade ? [...base, upgrade] : base;
}
