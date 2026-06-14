import {
  el,
  type ManualSection,
  paragraph,
  sectionRoot,
  titledBlock,
} from '../manualSection';

/**
 * @file ui/manual/sections/basicsSection.ts
 * @description Builds the manual's "Basics" tab — intro paragraph, the descend/fight/collect/unlock/upgrade/survive loop (driven by LOOP_STEPS), and a closing pointer to the other tabs; deliberately short, just enough to orient a new player.
 * @module ui/manual/sections
 */

// ── Loop steps ─────────────────────────────────────────────────────────────
// The ordered gameplay-loop steps rendered in the tab (title + one-line detail).
const LOOP_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: 'Descend',
    detail:
      'Travel deeper through the connected levels.'
  },
  {
    title: 'Fight & sneak',
    detail:
      'Enemies wander the tunnels and guard the cities. ' +
      'Sneak behind their back or tackle them head on',
  },
  {
    title: 'Collect',
    detail:
      'Gather coins, ammo, magic shards, and heal items from fallen foes and ' +
      'chests.',
  },
  {
    title: 'Unlock the way',
    detail:
      'The path down is sealed by locked doors. Defeat the boss guarding a ' +
      'region to claim its key, then use it to open the door and descend deeper.',
  },
  {
    title: 'Upgrade',
    detail:
      'Spend coins at the tech shop and mushroom merchants to expand ammo, ' +
      'magic, and healing.',
  },
  {
    title: 'Survive',
    detail:
      'Manage your hearts, stamina, magic, and ammo. Run out of health and the ' +
      'run ends.',
  },
];

/**
 * @function    buildBasicsSection
 * @description Builds the Basics tab: welcome lead, the gameplay loop list, and a pointer to other tabs. Reads the static LOOP_STEPS copy.
 * @returns a detached ManualSection element tree (no animated previews).
 * @calledby src/ui/ManualOverlay.ts → the TABS registry, built when the overlay assembles its tab pages
 * @calls    src/ui/manual/manualSection.ts → sectionRoot, paragraph, titledBlock, el
 */
export function buildBasicsSection(): ManualSection {
  const root = sectionRoot();

  root.appendChild(
    paragraph(
      'Welcome to The Beneath. Descend through the dark, fight or evade what ' +
        'lives there, and gather what you need to press deeper.',
      'manual-lead',
    ),
  );

  const { block, body } = titledBlock('The Loop');
  const list = el('div', 'manual-loop');
  for (const step of LOOP_STEPS) {
    const row = el('div', 'manual-loop-step');
    row.appendChild(el('span', 'manual-loop-name', step.title));
    row.appendChild(el('span', 'manual-loop-detail', step.detail));
    list.appendChild(row);
  }
  body.appendChild(list);
  root.appendChild(block);

  root.appendChild(
    paragraph(
      'New here? Read the Controls and Combat tabs next, then check the HUD tab ' +
        'so you can read your meters at a glance.',
    ),
  );

  return { el: root, previews: [] };
}
