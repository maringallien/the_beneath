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
 * shopTypes — the shop item model and per-merchant inventory assembly.
 *
 * Defines the ShopItem discriminated union (a repeatable 'resource' restock vs a
 * one-time 'upgrade') and builds the inventory a given merchant offers in a given
 * level. The two fixed restock tables are static; capacity upgrades are appended
 * only at the three upgrade levels — a level is matched against AMMO_/MAGIC_
 * UPGRADE_LEVELS, and that array index doubles as the tier index into the
 * parallel price/step constants, so the tables must stay index-aligned.
 *
 * Inputs:  the shop/pricing constants, runProgress upgrade-id helper, and a
 *          merchant kind + current level id at call time.
 * Outputs: shop item descriptors and the assembled per-merchant inventory array;
 *          a window title string.
 * @calledby the shop UI/scene, when opening a merchant and rendering its stock.
 * @calls    the upgrade-id helper and the shop pricing/step constants only.
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

// builds the "Ammo Storage" upgrade descriptor for the tech shop at this level/tier
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

// builds the "Crystal Pouch" upgrade descriptor for the mushroom merchant at this level/tier
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

// returns the capacity upgrade for this merchant/level, or null if none applies
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

// assembles the merchant's full stock: fixed restocks plus the level's upgrade if one exists
export function shopItemsFor(
  kind: ShopKind,
  levelId: string | null,
): ReadonlyArray<ShopItem> {
  const base = kind === 'tech' ? TECH_SHOP_ITEMS : MUSHROOM_SHOP_ITEMS;
  const upgrade = upgradeItemFor(kind, levelId);
  return upgrade ? [...base, upgrade] : base;
}
