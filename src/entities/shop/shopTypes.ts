import {
  AMMO_UPGRADE_LEVELS,
  AMMO_UPGRADE_PRICES,
  GUN1_CAPACITY_UPGRADE_STEP,
  GUN2_CAPACITY_UPGRADE_STEP,
  HEAL_CROSS_TEXTURE_KEY,
  MAGIC_ORB_TEXTURE_KEY,
  MAGIC_UPGRADE_CAPACITY_STEPS,
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

/**
 * @file entities/shop/shopTypes.ts
 * @description ShopItem model (a repeatable 'resource' restock vs a one-time 'upgrade') plus the assembly of the inventory a merchant offers in a given level. The two fixed restock tables are static; a capacity upgrade is appended only at the three upgrade levels — a level matches against AMMO_/MAGIC_ UPGRADE_LEVELS, and that array index doubles as the tier index into the parallel price/step constants, so the tables must stay index-aligned. Read by the shop UI/scene when opening a merchant and rendering its stock.
 * @module entities/shop
 */

// which merchant is open — drives inventory selection and the window title
export type ShopKind = 'tech' | 'mushroom';

// 'resource' = repeatable restock routed through Player.addPickup; 'upgrade' = one-time capacity raise recorded in runProgress
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
  // cap increase description shown under the label (e.g. "+6 pistol / +4 shotgun max")
  readonly detail: string;
}

export type ShopItem = ResourceShopItem | UpgradeShopItem;

// hud_ammo frame indices mirroring PlayerHud's; hard-coded to avoid widening that class's public surface
const HUD_AMMO_GUN1_FRAME = 0;
const HUD_AMMO_GUN2_FRAME = 12;

// Fixed restock stock at every tech shop: pistol and shotgun ammo packs.
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

// Fixed restock stock at every mushroom merchant: a mana crystal and a med kit.
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

/**
 * @function    ammoUpgradeItem
 * @description Builds the "Ammo Storage" upgrade descriptor for the tech shop at this level/tier.
 * @param   levelId    Current LDtk level id.
 * @param   tierIndex  Index into the parallel price array.
 * @returns an UpgradeShopItem with this tier's price and the pistol/shotgun cap detail string.
 * @calledby src/entities/shop/shopTypes.ts → upgradeItemFor, when this level is an ammo-upgrade level
 * @calls    src/state/runProgress.ts → upgradeId, plus the ammo price/step constants
 */
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

/**
 * @function    magicUpgradeItem
 * @description Builds the "Crystal Pouch" upgrade descriptor for the mushroom merchant at this level/tier.
 * @param   levelId    Current LDtk level id.
 * @param   tierIndex  Index into the parallel step/price arrays.
 * @returns an UpgradeShopItem with this tier's price and the crystal-cap detail string.
 * @calledby src/entities/shop/shopTypes.ts → upgradeItemFor, when this level is a magic-upgrade level
 * @calls    src/state/runProgress.ts → upgradeId, plus the magic price/step constants
 */
function magicUpgradeItem(levelId: string, tierIndex: number): UpgradeShopItem {
  return {
    kind: 'upgrade',
    id: upgradeId('magic', levelId),
    upgradeType: 'magic',
    price: MAGIC_UPGRADE_PRICES[tierIndex],
    iconTextureKey: MAGIC_ORB_TEXTURE_KEY,
    label: 'Crystal Pouch',
    detail: `+${MAGIC_UPGRADE_CAPACITY_STEPS[tierIndex]} crystal max`,
  };
}

/**
 * @function    upgradeItemFor
 * @description Returns the capacity upgrade for this merchant/level, or null if none applies.
 * @param   kind     Which merchant: 'tech' or 'mushroom'.
 * @param   levelId  Current LDtk level id, or null.
 * @returns the matching UpgradeShopItem, or null when there's no level or this level isn't an upgrade level for that merchant.
 * @calledby src/entities/shop/shopTypes.ts → shopItemsFor, deciding whether to append an upgrade
 * @calls    src/entities/shop/shopTypes.ts → ammoUpgradeItem / magicUpgradeItem, after an UPGRADE_LEVELS index match
 */
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

/** Title rendered at the top of the shop window per merchant kind. */
export function shopTitleFor(kind: ShopKind): string {
  return kind === 'tech' ? 'TECH SHOP' : 'MUSHROOM MERCHANT';
}

/**
 * @function    shopItemsFor
 * @description Assembles the merchant's full stock: fixed restocks plus the level's upgrade if one exists.
 * @param   kind     Which merchant: 'tech' or 'mushroom'.
 * @param   levelId  Current LDtk level id, or null.
 * @returns a readonly ShopItem array — the fixed restock table, with the level's capacity upgrade appended when one applies.
 * @calledby src/ui/ShopOverlay.ts → opening a merchant to populate its item list
 * @calls    src/entities/shop/shopTypes.ts → upgradeItemFor, then concatenates onto the per-kind restock table
 */
export function shopItemsFor(
  kind: ShopKind,
  levelId: string | null,
): ReadonlyArray<ShopItem> {
  const base = kind === 'tech' ? TECH_SHOP_ITEMS : MUSHROOM_SHOP_ITEMS;
  const upgrade = upgradeItemFor(kind, levelId);
  return upgrade ? [...base, upgrade] : base;
}
