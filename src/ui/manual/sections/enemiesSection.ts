import {
  el,
  type ManualSection,
  markerRow,
  paragraph,
  sectionRoot,
  titledBlock,
} from '../manualSection';

/**
 * enemiesSection — builds the manual's "Enemies" tab (stealth/detection + bestiary).
 *
 * Teaches the detection system: the ? "investigating" and ! "detected" states and
 * how the screen-edge corner brackets recolour to show exposure, then lists the
 * broad enemy archetypes from the ENEMY_TYPES table below. Deliberately not an
 * exhaustive bestiary — it teaches how to read alerts and what kinds of threats
 * exist, not stats for every foe.
 *
 * Inputs:  the static ENEMY_TYPES copy below and the shared manual DOM helpers.
 * Outputs: a detached ManualSection element tree (no animated previews).
 * @calledby the in-game manual overlay, when assembling its tab pages.
 * @calls    the shared manual DOM/section helpers, including the marker-row builder.
 */

// The enemy archetype overview: each faction's display name and one-line summary.
const ENEMY_TYPES: ReadonlyArray<{ name: string; detail: string }> = [
  {
    name: 'City guardians',
    detail:
      'Wheel bots, hell bots, assassins, and flame throwers patrol in and around ' +
      'cities, defending them from intruders and monsters.',
  },
  {
    name: 'Cave monsters',
    detail:
      'Ghouls, spitters, summoners, dark wardens, caged spiders, caged shockers, ' +
      'evil crows, and wasps roam the underground caves.',
  },
  {
    name: 'Bandits',
    detail:
      'Archer and dagger bandits hole up in lairs, guarding the treasure ' +
      'stashed there.',
  },
  {
    name: 'Bosses',
    detail:
      'The Shadow of Storms, the Tarnished Widow, and the Heart Hoarder guard ' +
      'key paths — learn their patterns before you commit.',
  },
  {
    name: 'NPCs',
    detail:
      'Not everything wants you dead: spirit walkers wander the cities, and ' +
      'spark bugs hover above hidden traps — a handy warning sign.',
  },
];

// builds the Enemies tab: detection states (?/!) and a broad enemy-type overview
export function buildEnemiesSection(): ManualSection {
  const root = sectionRoot();

  root.appendChild(
    paragraph(
      'Most foes start unaware. How you approach decides whether you fight on ' +
        'your terms or theirs.',
      'manual-lead',
    ),
  );

  const detect = titledBlock('Getting spotted');
  detect.body.appendChild(
    paragraph(
      'Enemies see within a vision cone and a close-range radius. The corner ' +
        'brackets at the screen edges track how exposed you are:',
    ),
  );
  detect.body.appendChild(
    markerRow(
      '?',
      'Investigating (brackets turn yellow)',
      'Something caught their eye. Break line of sight or back off and they ' +
        'settle down.',
      'manual-marker manual-marker--warn',
    ),
  );
  detect.body.appendChild(
    markerRow(
      '!',
      'Detected (brackets turn red)',
      "You've been spotted. The enemy commits — it stops, then rushes you.",
      'manual-marker manual-marker--alarm',
    ),
  );
  detect.body.appendChild(
    paragraph(
      'Faint white brackets mean nothing has noticed you. Strike from stealth ' +
        'for a decisive opening.',
    ),
  );
  root.appendChild(detect.block);

  const types = titledBlock('What you’ll face');
  const list = el('div', 'manual-loop');
  for (const type of ENEMY_TYPES) {
    const row = el('div', 'manual-loop-step');
    row.appendChild(el('span', 'manual-loop-name', type.name));
    row.appendChild(el('span', 'manual-loop-detail', type.detail));
    list.appendChild(row);
  }
  types.body.appendChild(list);
  root.appendChild(types.block);

  return { el: root, previews: [] };
}
