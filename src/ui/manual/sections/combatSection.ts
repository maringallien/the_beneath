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
 * @file ui/manual/sections/combatSection.ts
 * @description Builds the manual's "Combat" tab — one looping animated preview per attack (sword/magic/gun1/gun2) beside a short how-to with key chips. Previews are returned in the ManualSection so the overlay can drive their own rAF loop (Phaser's anim manager is paused while the menu is open); an unbuildable preview degrades to a "preview unavailable" placeholder.
 * @module ui/manual/sections
 */

// ── Preview stage size ─────────────────────────────────────────────────────
// Max stage size (CSS px) that previews are fitted into.
const PREVIEW_MAX_WIDTH_PX = 520;
const PREVIEW_MAX_HEIGHT_PX = 128;

/**
 * @function    buildCombatSection
 * @description Builds the Combat tab: one animated demo row per weapon, collecting previews for the overlay to drive; a missing preview degrades to a placeholder.
 * @param   scene  For constructing the sprite previews from loaded textures.
 * @returns a ManualSection whose element tree AND list of live previews are returned.
 * @calledby src/ui/ManualOverlay.ts → the TABS registry, built when the overlay assembles its tab pages
 * @calls    src/ui/manual/combatClips.ts → buildWeaponDemos, the AnimatedSpritePreview factory, and src/ui/manual/manualSection.ts → keyChips/el/paragraph
 */
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
