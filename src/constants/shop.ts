// Merchant shops: per-item prices, per-purchase grants, and the one-time
// capacity upgrades.

import {
  AMMO_PICKUP_GUN1_AMOUNT,
  AMMO_PICKUP_GUN2_AMOUNT,
  HEAL_PICKUP_AMOUNT,
  MAGIC_PICKUP_AMOUNT,
} from './player';

// Per-item coin price. Tuned so a few cleared rooms (each enemy drops ≥1
// coin, chests 5, bosses 20) can fund a small restock without trivializing
// pickups. Gun2 charges more per shell because gun2 hits harder; magic orbs
// are the priciest because each orb refills one of only 3 magic bars.
export const SHOP_PRICE_GUN1_AMMO = 10;
export const SHOP_PRICE_GUN2_AMMO = 15;
export const SHOP_PRICE_MAGIC_ORB = 25;
// Healing heart: priced between an ammo pack and a magic orb. Each heart
// restores HEAL_ITEM_RESTORE_AMOUNT (25) health, so a full top-up from near
// death costs ~3-4 hearts — a meaningful coin sink without being punishing.
export const SHOP_PRICE_HEAL_ITEM = 20;

// Per-purchase grant. Aliased to the existing pickup amounts so buying a
// gun1 magazine grants the same N bullets as walking into a gun1 drop —
// keeps the value-per-unit consistent across drop and shop economies.
export const SHOP_GUN1_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN1_AMOUNT;
export const SHOP_GUN2_GRANT_PER_PURCHASE = AMMO_PICKUP_GUN2_AMOUNT;
export const SHOP_MAGIC_GRANT_PER_PURCHASE = MAGIC_PICKUP_AMOUNT;
export const SHOP_HEAL_GRANT_PER_PURCHASE = HEAL_PICKUP_AMOUNT;

// ── Capacity upgrades (Ammo Storage / Orb Pouch) ─────────────────────────
// One-time purchases that permanently raise the player's carry cap, sold
// alongside the normal restock items. Each tech shop (Tech_shop_spawn) sells
// one Ammo Storage tier; each mushroom merchant (Mushroom_merchant_spawn) sells
// one Orb Pouch tier. Both shop types live in Level_23/21/16, so these arrays
// MUST list those levels (the level is the upgrade's identity — a shop's tier
// can be bought exactly once). They're ordered by descent: Level_23 (reached
// first) is cheapest, Level_16 (reached last) priciest, since later tiers are
// reached with more coins in hand. Purchases persist in runProgress (surviving
// death/respawn). Ammo caps derive from the COUNT of purchases (uniform step),
// while magic sums each bought tier's MAGIC_UPGRADE_CAPACITY_STEPS (uneven), so
// either way any visiting order yields the same fully-upgraded total.
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
// Per-tier magic cap gain, index-aligned with MAGIC_UPGRADE_LEVELS / _PRICES:
// Level_23 +3, Level_21 +2, Level_16 +2 → BASE_MAX_MAGIC (3) climbs to 10.
export const MAGIC_UPGRADE_CAPACITY_STEPS: ReadonlyArray<number> = [3, 2, 2];
