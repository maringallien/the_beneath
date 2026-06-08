import {
  AMMO_PICKUP_GUN1_AMOUNT,
  AMMO_PICKUP_GUN2_AMOUNT,
  BASE_MAX_MAGIC,
  HEAL_ITEM_RESTORE_AMOUNT,
  MAGIC_UPGRADE_CAPACITY_STEPS,
  SHOP_PRICE_GUN1_AMMO,
  SHOP_PRICE_GUN2_AMMO,
  SHOP_PRICE_HEAL_ITEM,
} from '../../../constants';

// Fully-upgraded orb cap (base + every Crystal Pouch tier), so the copy tracks
// the constants instead of hardcoding the number.
const MAGIC_MAX_CAPACITY =
  BASE_MAX_MAGIC + MAGIC_UPGRADE_CAPACITY_STEPS.reduce((sum, step) => sum + step, 0);
import {
  el,
  glyphRow,
  type ManualSection,
  paragraph,
  sectionRoot,
  titledBlock,
} from '../manualSection';

// Items tab — what you pick up, what's in the world, and where to spend coins.
// Pickup rows reuse the HUD glyphs; world features and merchants are short
// name/detail rows. Numbers come from the economy constants.

const WORLD_FEATURES: ReadonlyArray<{ name: string; detail: string }> = [
  {
    name: 'Chests',
    detail: 'Contain coins and items. Open them with Interact (E).',
  },
  {
    name: 'Boss keys',
    detail:
      'Each boss drops a key when defeated. Carry it to the locked door it ' +
      'opens — you can’t descend past a gate without its key.',
  },
  {
    name: 'Save beacons',
    detail: 'Record your progress when you interact with them.',
  },
  {
    name: 'Doors',
    detail:
      'Some doors stay locked until you obtain the matching key.',
  },
];

export function buildItemsSection(): ManualSection {
  const root = sectionRoot();

  root.appendChild(
    paragraph(
      'Fallen enemies and chests drop what keeps you going. Grab everything — ' +
        'coins buy upgrades you’ll need below.',
      'manual-lead',
    ),
  );

  const pickups = titledBlock('Pickups');
  pickups.body.appendChild(
    glyphRow('coin', 'Coins', 'Currency for the merchants.'),
  );
  pickups.body.appendChild(
    glyphRow(
      'orb',
      'Magic orbs',
      'Refill the magic you spend on casts.',
    ),
  );
  pickups.body.appendChild(
    glyphRow(
      'heal',
      'Heal items',
      `Stored for later — press Q to restore ${HEAL_ITEM_RESTORE_AMOUNT} HP.`,
    ),
  );
  pickups.body.appendChild(
    glyphRow(
      'gun1',
      'Pistol ammo',
      `Drops restock +${AMMO_PICKUP_GUN1_AMOUNT} pistol rounds.`,
    ),
  );
  pickups.body.appendChild(
    glyphRow(
      'gun2',
      'Shotgun ammo',
      `Drops restock +${AMMO_PICKUP_GUN2_AMOUNT} shotgun shell.`,
    ),
  );
  root.appendChild(pickups.block);

  const world = titledBlock('In the world');
  const list = el('div', 'manual-loop');
  for (const feature of WORLD_FEATURES) {
    const row = el('div', 'manual-loop-step');
    row.appendChild(el('span', 'manual-loop-name', feature.name));
    row.appendChild(el('span', 'manual-loop-detail', feature.detail));
    list.appendChild(row);
  }
  world.body.appendChild(list);
  root.appendChild(world.block);

  const shops = titledBlock('Merchants');
  shops.body.appendChild(
    paragraph(
      `The tech shop sells pistol ammo (${SHOP_PRICE_GUN1_AMMO}c), shotgun ammo ` +
        `(${SHOP_PRICE_GUN2_AMMO}c), and capacity upgrades for both guns.`,
    ),
  );
  shops.body.appendChild(
    paragraph(
      `Mushroom merchants sell heal items (${SHOP_PRICE_HEAL_ITEM}c), magic orbs, ` +
        `and an Orb Pouch upgrade — one per merchant — that raises your orb ` +
        `capacity from ${BASE_MAX_MAGIC} up to ${MAGIC_MAX_CAPACITY}.`,
    ),
  );
  root.appendChild(shops.block);

  return { el: root, previews: [] };
}
