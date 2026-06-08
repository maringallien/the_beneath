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

// Combat tab — one looping animated preview per attack (sword / magic / gun1 /
// gun2), each cycling its full combo chain, beside a short how-to. The previews
// run on their own rAF loop (Phaser's animation manager is paused while the menu
// is open), so the overlay starts/stops them when this tab is shown/hidden.

// Box every preview is fitted into (CSS px). Wide swing frames fill the width;
// tall spell frames fill the height — all stay inside the stage.
const PREVIEW_MAX_WIDTH_PX = 520;
const PREVIEW_MAX_HEIGHT_PX = 128;

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
