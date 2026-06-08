import {
  BASE_MAX_MAGIC,
  HEAL_ITEM_RESTORE_AMOUNT,
  MAGIC_COST_PER_SWING,
  MAX_HEAL_ITEMS,
  MAX_STAMINA,
  PLAYER_MAX_HEALTH,
  STAMINA_REGEN_INTERVAL_MS,
} from '../../../constants';
import {
  glyphRow,
  type ManualSection,
  sectionRoot,
  titledBlock,
} from '../manualSection';

// HUD tab — a legend for every on-screen meter, grouped by where it sits on
// screen. Uses the real HUD glyphs (createHudIcon via glyphRow) so the icons are
// pixel-identical to the live HUD, and pulls its numbers from the same constants
// gameplay uses.

const STAMINA_REGEN_S = Math.round(STAMINA_REGEN_INTERVAL_MS / 1000);

export function buildHudSection(): ManualSection {
  const root = sectionRoot();

  const left = titledBlock('Top-left — Vitals');
  left.body.appendChild(
    glyphRow(
      'heart',
      'Health',
      `Your life, shown as hearts (${PLAYER_MAX_HEALTH} HP total). Lose it all ` +
        `and the run ends.`,
    ),
  );
  left.body.appendChild(
    glyphRow(
      'stamina',
      'Stamina',
      `${MAX_STAMINA} volt. Dashing spends a stamina, which regenerates one volt every ` +
        `${STAMINA_REGEN_S} seconds when you're not dashing.`,
    ),
  );
  root.appendChild(left.block);

  const right = titledBlock('Top-right — Resources');
  right.body.appendChild(
    glyphRow(
      'gun1',
      'Pistol ammo',
      'Rounds for Gun 1',
    ),
  );
  right.body.appendChild(
    glyphRow(
      'gun2',
      'Shotgun ammo',
      'Shells for Gun 2',
    ),
  );
  right.body.appendChild(
    glyphRow(
      'orb',
      'Magic orbs',
      `Fuel for magic casts (start cap ${BASE_MAX_MAGIC}). Each cast spends ` +
        `${MAGIC_COST_PER_SWING}. Magic does not regenerate. Gather orbs or buy refills.`,
    ),
  );
  right.body.appendChild(
    glyphRow(
      'coin',
      'Coins',
      'Currency from enemies and chests. Spend it at the tech shops and ' +
        'mushroom merchants.',
    ),
  );
  right.body.appendChild(
    glyphRow(
      'heal',
      'Heal items',
      `Carry up to ${MAX_HEAL_ITEMS}. Press Q to use one and restore ` +
        `${HEAL_ITEM_RESTORE_AMOUNT} HP.`,
    ),
  );
  root.appendChild(right.block);

  const bottom = titledBlock('Bottom-left — Weapon');
  bottom.body.appendChild(
    glyphRow(
      'sword',
      'Active weapon',
      'Shows your current weapon (Sword, Gun 1, or Gun 2). In sword mode a ' +
        'MAGIC tag lights when the magic stance is on.',
    ),
  );
  root.appendChild(bottom.block);

  return { el: root, previews: [] };
}
