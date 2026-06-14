import type Phaser from 'phaser';
import type { AnimatedSpritePreview } from '../animatedSpritePreview';
import { createHudIcon, type HudIconName } from '../hudIcons';

/**
 * @file ui/manual/manualSection.ts
 * @description Shared ManualSection contract + DOM helpers for the "How to Play" tabs (section root, paragraphs, titled blocks, key-chip rows, HUD-glyph / marker legend rows); each builder returns a detached tree the overlay mounts, plus any sprite previews so only the visible tab's rAF loops run.
 * @module ui/manual
 */

export interface ManualSection {
  readonly el: HTMLElement;
  readonly previews: ReadonlyArray<AnimatedSpritePreview>;
}

// A tab builder: takes the scene (for sprite previews) and returns its section.
export type SectionBuilder = (scene: Phaser.Scene) => ManualSection;

/**
 * @function    el
 * @description Create a typed DOM element with optional class and text — base primitive for all helpers.
 * @param   tag        HTML tag name.
 * @param   className  Optional CSS class.
 * @param   text       Optional text content.
 * @returns the created element, typed to the requested tag.
 * @calledby widely used — every manual section helper and tab builder
 * @calls    the DOM document's element-create API
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The empty root container a tab builder fills and returns as its section element. */
export function sectionRoot(): HTMLElement {
  return el('div', 'manual-section');
}

/** A styled <p> of body copy (defaults to the standard manual paragraph class). */
export function paragraph(
  text: string,
  className = 'manual-p',
): HTMLParagraphElement {
  return el('p', className, text);
}

/**
 * @function    titledBlock
 * @description Builds a headed block and returns the outer wrapper and the empty body to fill.
 * @param   title  The block heading text.
 * @returns a { block, body } pair — block is the mountable wrapper, body the empty content host.
 * @calledby widely used — tab builders laying out a titled content section (basics, hud, enemies, items)
 * @calls    src/ui/manual/manualSection.ts → el
 */
export function titledBlock(title: string): {
  block: HTMLElement;
  body: HTMLElement;
} {
  const block = el('div', 'manual-block');
  block.appendChild(el('h3', 'options-category-title', title));
  const body = el('div', 'manual-block-body');
  block.appendChild(body);
  return { block, body };
}

/**
 * @function    keyChips
 * @description Renders key chips in a row; optional joiner (e.g. "+") marks keys pressed together.
 * @param   keys       The labels to chip.
 * @param   className  Row class.
 * @param   joiner     Optional separator drawn between chips.
 * @returns a row element of kbd chips, with joiners between them when requested.
 * @calledby src/ui/manual/sections/controlsSection.ts → commandRow, src/ui/manual/sections/combatSection.ts → buildCombatSection
 * @calls    src/ui/manual/manualSection.ts → el
 */
export function keyChips(
  keys: ReadonlyArray<string>,
  className = 'manual-keys',
  joiner?: string,
): HTMLElement {
  const row = el('span', className);
  keys.forEach((key, index) => {
    if (joiner && index > 0) row.appendChild(el('span', 'manual-key-plus', joiner));
    row.appendChild(el('kbd', 'options-key', key));
  });
  return row;
}

/**
 * @function    glyphRow
 * @description Legend row with the real HUD SVG glyph, a name, and a description.
 * @param   iconName  Which HUD glyph.
 * @param   name      Label.
 * @param   desc      Description text.
 * @returns a legend-row element pairing the live HUD glyph with its name and description.
 * @calledby src/ui/manual/sections/hudSection.ts → buildHudSection, src/ui/manual/sections/itemsSection.ts → buildItemsSection
 * @calls    src/ui/hudIcons.ts → createHudIcon and src/ui/manual/manualSection.ts → el
 */
export function glyphRow(
  iconName: HudIconName,
  name: string,
  desc: string,
): HTMLElement {
  const row = el('div', 'manual-glyph-row');
  const iconWrap = el('div', 'manual-glyph');
  iconWrap.appendChild(createHudIcon(iconName, 'manual-glyph-svg'));
  row.appendChild(iconWrap);
  const text = el('div', 'manual-glyph-text');
  text.appendChild(el('span', 'manual-glyph-name', name));
  text.appendChild(el('span', 'manual-glyph-desc', desc));
  row.appendChild(text);
  return row;
}

/**
 * @function    markerRow
 * @description Like glyphRow but uses a plain text character instead of an SVG glyph.
 * @param   marker       The text character.
 * @param   name         Label.
 * @param   desc         Description.
 * @param   markerClass  Optional marker CSS class.
 * @returns a legend-row element pairing a typographic marker with its name and description.
 * @calledby src/ui/manual/sections/enemiesSection.ts → buildEnemiesSection, for the ?/! detection markers
 * @calls    src/ui/manual/manualSection.ts → el
 */
export function markerRow(
  marker: string,
  name: string,
  desc: string,
  markerClass = 'manual-marker',
): HTMLElement {
  const row = el('div', 'manual-glyph-row');
  const iconWrap = el('div', 'manual-glyph');
  iconWrap.appendChild(el('span', markerClass, marker));
  row.appendChild(iconWrap);
  const text = el('div', 'manual-glyph-text');
  text.appendChild(el('span', 'manual-glyph-name', name));
  text.appendChild(el('span', 'manual-glyph-desc', desc));
  row.appendChild(text);
  return row;
}
