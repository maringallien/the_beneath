import type Phaser from 'phaser';
import { AnimatedSpritePreview } from '../../animatedSpritePreview';
import { buildWeaponDemos } from '../combatClips';
import {
  el,
  keyChips,
  type ManualSection,
  paragraph,
  sectionRoot,
} from '../manualSection';

/**
 * combatSection — builds the manual's "Combat" tab (one animated demo per attack).
 *
 * Lays out a looping animated preview for each attack (sword / magic / gun1 / gun2),
 * each cycling its full combo chain, beside a short how-to with its key chips. The
 * previews are created here and returned in the ManualSection so the overlay can
 * drive them: they run on their own rAF loop because Phaser's animation manager is
 * paused while the menu is open, so the overlay starts/stops them as the tab is
 * shown or hidden. A preview that can't be built degrades to a "preview unavailable"
 * placeholder rather than breaking the row.
 *
 * Inputs:  the scene (for sprite previews), the weapon-demo table, and DOM helpers.
 * Outputs: a ManualSection whose element tree AND list of live previews are returned.
 * @calledby the in-game manual overlay, when assembling its tab pages.
 * @calls    the weapon-demo source, the animated-sprite-preview factory, and the
 *           shared manual DOM/key-chip helpers.
 */

// max stage size (CSS px) that previews are fitted into
const PREVIEW_MAX_WIDTH_PX = 520;
const PREVIEW_MAX_HEIGHT_PX = 128;

// builds the Combat tab: one animated demo row per weapon, collecting previews for the overlay to drive
export function buildCombatSection(scene: Phaser.Scene): ManualSection {
  const root = sectionRoot();
  const previews: AnimatedSpritePreview[] = [];

  root.appendChild(
    paragraph(
      'Scroll the mouse wheel to switch between the sword and the two guns.'
    ),
  );

  for (const demo of buildWeaponDemos()) {
    const row = el('div', 'manual-combat-row');

    const stage = el('div', 'manual-combat-stage');
    const preview = new AnimatedSpritePreview({
      scene,
      clips: demo.clips,
      maxWidthPx: PREVIEW_MAX_WIDTH_PX,
      maxHeightPx: PREVIEW_MAX_HEIGHT_PX,
    });
    if (preview.isAvailable()) {
      stage.appendChild(preview.el);
      previews.push(preview);
    } else {
      stage.appendChild(
        el('span', 'manual-combat-missing', 'preview unavailable'),
      );
    }
    row.appendChild(stage);

    const info = el('div', 'manual-combat-info');
    const head = el('div', 'manual-combat-head');
    head.appendChild(el('span', 'manual-combat-title', demo.title));
    head.appendChild(keyChips(demo.keys, 'manual-combat-keys', demo.keyJoiner));
    info.appendChild(head);
    info.appendChild(paragraph(demo.blurb, 'manual-combat-blurb'));
    row.appendChild(info);

    root.appendChild(row);
  }

  return { el: root, previews };
}
