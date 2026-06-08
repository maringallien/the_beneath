import {
  el,
  keyChips,
  type ManualSection,
  sectionRoot,
} from '../manualSection';

// Controls tab — the player-facing key cheat sheet. These mirror the
// authoritative bindings in Player / InteractionManager (debug-only keys like
// fly mode are intentionally omitted); this is presentation only. Ported
// verbatim from the original OptionsOverlay so the controls list is unchanged.

interface CommandRow {
  readonly keys: ReadonlyArray<string>;
  readonly label: string;
}

interface CommandCategory {
  readonly title: string;
  readonly commands: ReadonlyArray<CommandRow>;
}

const CATEGORIES: ReadonlyArray<CommandCategory> = [
  {
    title: 'Movement',
    commands: [
      { keys: ['A', 'D'], label: 'Move' },
      { keys: ['W'], label: 'Jump' },
      { keys: ['S'], label: 'Roll' },
      { keys: ['Shift'], label: 'Dash' },
    ],
  },
  {
    title: 'Actions',
    commands: [
      { keys: ['E'], label: 'Interact (hold)' },
      { keys: ['F'], label: 'Toggle magic stance' },
      { keys: ['Q'], label: 'Use heal item' },
    ],
  },
  {
    title: 'Mouse',
    commands: [
      { keys: ['L-Click'], label: 'Attack / Fire' },
      { keys: ['R-Click'], label: 'Block' },
      { keys: ['Wheel'], label: 'Switch weapon' },
    ],
  },
];

function commandRow(command: CommandRow): HTMLElement {
  const row = el('div', 'options-command');
  const keys = keyChips(command.keys, 'options-command-keys');
  row.appendChild(keys);
  row.appendChild(el('span', 'options-command-label', command.label));
  return row;
}

export function buildControlsSection(): ManualSection {
  const root = sectionRoot();
  const grid = el('div', 'manual-controls');

  for (const category of CATEGORIES) {
    const block = el('div', 'options-category');
    block.appendChild(el('h3', 'options-category-title', category.title));
    for (const command of category.commands) {
      block.appendChild(commandRow(command));
    }
    grid.appendChild(block);
  }

  root.appendChild(grid);
  return { el: root, previews: [] };
}
