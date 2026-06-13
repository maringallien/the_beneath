import {
  el,
  type ManualSection,
  paragraph,
  sectionRoot,
  titledBlock,
} from '../manualSection';

/**
 * basicsSection — builds the manual's "Basics" tab (objective + core gameplay loop).
 *
 * Assembles the intro paragraph, the descend → fight → collect → unlock → upgrade →
 * survive loop (driven by the LOOP_STEPS table below), and a closing pointer to the
 * other tabs. Deliberately short — just enough to orient a new player before they
 * read Controls and Combat.
 *
 * Inputs:  the static LOOP_STEPS copy below and the shared manual DOM helpers.
 * Outputs: a detached ManualSection element tree (no animated previews).
 * @calledby the in-game manual overlay, when assembling its tab pages.
 * @calls    the shared manual DOM/section helpers to build the element tree.
 */

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

// builds the Basics tab: welcome lead, the gameplay loop list, and a pointer to other tabs
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
