import {
  el,
  keyChips,
  type ManualSection,
  sectionRoot,
} from '../manualSection';

/**
 * controlsSection — builds the manual's "Controls" tab (the key cheat sheet).
 *
 * Lays out movement / actions / mouse bindings as labelled key-chip rows grouped
 * by category. This is presentation only: the rows mirror the authoritative
 * bindings owned by the player and interaction systems (debug-only keys such as
 * fly mode are intentionally omitted), so editing this table changes the cheat
 * sheet, not the actual controls.
 *
 * Inputs:  the static CATEGORIES table below and the shared manual DOM helpers.
 * Outputs: a detached ManualSection element tree (no animated previews).
 * @calledby the in-game manual overlay, when assembling its tab pages.
 * @calls    the shared manual DOM/section helpers and the key-chip builder.
 */

// One binding row: the keys to display as chips and the action they perform.
interface CommandRow {
  readonly keys: ReadonlyArray<string>;
  readonly label: string;
}

// A titled group of binding rows (e.g. Movement, Actions, Mouse).
interface CommandCategory {
  readonly title: string;
  readonly commands: ReadonlyArray<CommandRow>;
}

// The full cheat sheet: every category and its bindings, in display order.
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

// Builds one binding row: its key chips followed by the action label.
function commandRow(command: CommandRow): HTMLElement {
  const row = el('div', 'options-command');
  const keys = keyChips(command.keys, 'options-command-keys');
  row.appendChild(keys);
  row.appendChild(el('span', 'options-command-label', command.label));
  return row;
}

// builds the Controls tab: a grid of key-binding rows grouped by category
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
