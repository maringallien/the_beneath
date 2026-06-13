import type Phaser from 'phaser';
import type { AnimatedSpritePreview } from '../animatedSpritePreview';
import { createHudIcon, type HudIconName } from '../hudIcons';

/**
 * manualSection — shared contract and DOM helpers for the "How to Play" manual tabs.
 *
 * Defines the ManualSection return shape every tab builder produces and the small
 * set of element-construction helpers they share (section root, paragraphs, titled
 * blocks, key-chip rows, and HUD-glyph / typographic-marker rows). Each builder
 * assembles a detached element tree; the manual overlay mounts the trees in its
 * scrolling host and toggles which one is visible. A section carrying animated
 * sprite previews returns them so the overlay can start/stop their rAF loops as a
 * tab gains or loses focus — only the visible tab animates.
 *
 * Inputs:  plain strings/class names from the tab builders, plus HUD icon names.
 * Outputs: detached DOM nodes and the ManualSection contract used by every tab.
 * @calledby the per-tab section builders, while assembling their element trees.
 * @calls    the DOM document for element creation and the shared HUD icon factory.
 */

export interface ManualSection {
  readonly el: HTMLElement;
  readonly previews: ReadonlyArray<AnimatedSpritePreview>;
}

// A tab builder: takes the scene (for sprite previews) and returns its section.
export type SectionBuilder = (scene: Phaser.Scene) => ManualSection;

// create a typed DOM element with optional class and text — base primitive for all helpers
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

// The empty root container a tab builder fills and returns as its section element.
export function sectionRoot(): HTMLElement {
  return el('div', 'manual-section');
}

// A styled <p> of body copy (defaults to the standard manual paragraph class).
export function paragraph(
  text: string,
  className = 'manual-p',
): HTMLParagraphElement {
  return el('p', className, text);
}

// builds a headed block and returns the outer wrapper and the empty body to fill
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

// renders key chips in a row; optional joiner (e.g. "+") marks keys pressed together
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

// legend row with the real HUD SVG glyph, a name, and a description
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

// like glyphRow but uses a plain text character instead of an SVG glyph
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
