import {
  AMMO_PICKUP_GUN1_AMOUNT,
  AMMO_PICKUP_GUN2_AMOUNT,
  HEAL_PICKUP_AMOUNT,
  MAGIC_PICKUP_AMOUNT,
} from './player';

/**
 * @file constants/shop.ts
 * @description Tech/mushroom merchant coin economy — per-item prices, per-purchase grants (aliased to pickup amounts), and the one-time carry-cap upgrade ladders.
 * @module constants
 */

// ── Item prices ────────────────────────────────────────────────────────────
// Gun2 charges more because it hits harder; orbs are priciest because there are only 3 base magic bars.
// A full heal top-up from near death costs ~3-4 hearts — meaningful without being punishing.
export const SHOP_PRICE_GUN1_AMMO = 10;
export const SHOP_PRICE_GUN2_AMMO = 15;
export const SHOP_PRICE_MAGIC_ORB = 25;
export const SHOP_PRICE_HEAL_ITEM = 20;

// ── Per-purchase grants ────────────────────────────────────────────────────
// Aliased to the player's pickup amounts so a buy grants the same quantity as a world drop.
export const SHOP_GUN1_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN1_AMOUNT;
export const SHOP_GUN2_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN2_AMOUNT;
export const SHOP_MAGIC_GRANT_PER_PURCHASE = MAGIC_PICKUP_AMOUNT;
export const SHOP_HEAL_GRANT_PER_PURCHASE = HEAL_PICKUP_AMOUNT;

// ── Capacity upgrades (Ammo Storage / Orb Pouch) ───────────────────────────
// Arrays keyed by the LDtk levels (Level_23/21/16) where the shops sit, ordered by descent (cheapest→priciest,
// earliest→latest). The level IS the upgrade's identity, so each tier is buyable exactly once and any visit
// order yields the same total, applied against persistent run progress. Magic steps are uneven, so the magic
// cap must be summed rather than counted: 3→6→8→10.
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
export const MAGIC_UPGRADE_CAPACITY_STEPS: ReadonlyArray<number> = [3, 2, 2];
