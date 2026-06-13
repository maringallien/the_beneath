import {
  AMMO_PICKUP_GUN1_AMOUNT,
  AMMO_PICKUP_GUN2_AMOUNT,
  HEAL_PICKUP_AMOUNT,
  MAGIC_PICKUP_AMOUNT,
} from './player';

/**
 * shop constants — merchant prices, per-purchase grants, and capacity upgrades.
 *
 * The coin economy for the tech and mushroom merchants: per-item prices, the
 * per-purchase grant amounts (aliased to the player's pickup amounts so a buy
 * matches a drop), and the one-time carry-cap upgrade ladders. The upgrade
 * arrays are keyed by the LDtk levels (Level_23/21/16) where the shops sit and
 * ordered by descent (earliest cheapest); that level IS the upgrade's identity,
 * so each tier is buyable exactly once and any visit order yields the same total.
 *
 * Inputs:  the player pickup amounts (for grant aliasing); otherwise compile-time.
 * Outputs: the SHOP_PRICE_*, SHOP_*_GRANT_PER_PURCHASE, and *_UPGRADE_* values below.
 * @calledby the shop overlay pricing/inventory and the purchase flow that grants
 *           items or applies a capacity upgrade against persistent run progress.
 * @calls    nothing — a leaf data module.
 */

// Gun2 charges more because it hits harder; orbs are priciest because there are only 3 base magic bars.
export const SHOP_PRICE_GUN1_AMMO = 10;
export const SHOP_PRICE_GUN2_AMMO = 15;
export const SHOP_PRICE_MAGIC_ORB = 25;
// Full top-up from near death costs ~3-4 hearts — meaningful without being punishing.
export const SHOP_PRICE_HEAL_ITEM = 20;

// Aliased to pickup amounts so a buy grants the same as a world drop.
export const SHOP_GUN1_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN1_AMOUNT;
export const SHOP_GUN2_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN2_AMOUNT;
export const SHOP_MAGIC_GRANT_PER_PURCHASE = MAGIC_PICKUP_AMOUNT;
export const SHOP_HEAL_GRANT_PER_PURCHASE = HEAL_PICKUP_AMOUNT;

// ── Capacity upgrades (Ammo Storage / Orb Pouch) ─────────────────────────
// The level IS the upgrade identity — each tier is buyable exactly once; ordered cheapest→priciest (earliest→latest).
export const AMMO_UPGRADE_LEVELS: ReadonlyArray<string> = [
  'Level_23',
  'Level_21',
  'Level_16',
];
export const MAGIC_UPGRADE_LEVELS: ReadonlyArray<string> = [
  'Level_23',
  'Level_21',
  'Level_16',
];
export const AMMO_UPGRADE_PRICES: ReadonlyArray<number> = [30, 45, 60];
export const MAGIC_UPGRADE_PRICES: ReadonlyArray<number> = [30, 45, 60];
// Uneven steps so magic cap must be summed, not counted: 3→6→8→10.
export const MAGIC_UPGRADE_CAPACITY_STEPS: ReadonlyArray<number> = [3, 2, 2];
