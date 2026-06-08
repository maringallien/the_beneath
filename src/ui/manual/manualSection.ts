import type Phaser from 'phaser';
import type { AnimatedSpritePreview } from '../animatedSpritePreview';
import { createHudIcon, type HudIconName } from '../hudIcons';

// Shared contract + DOM helpers for the "How to Play" manual's tab sections.
// Each section builds a detached element tree; ManualOverlay mounts them in the
// scrolling content host and toggles which one is visible. Sections that contain
// animated sprite previews return them so the overlay can start/stop their rAF
// loops as the tab gains/loses focus (only the visible tab animates).

export interface ManualSection {
  readonly el: HTMLElement;
  readonly previews: ReadonlyArray<AnimatedSpritePreview>;
}

export type SectionBuilder = (scene: Phaser.Scene) => ManualSection;

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

export function sectionRoot(): HTMLElement {
  return el('div', 'manual-section');
}

export function paragraph(
  text: string,
  className = 'manual-p',
): HTMLParagraphElement {
  return el('p', className, text);
}

// Titled block reusing the options-tab category heading style, returning the
// outer block plus the body the caller fills.
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

// A row of key chips reusing the Controls-tab key styling. Pass `joiner` (e.g.
// "+") to render a separator between chips when the keys are pressed together
// (a combo like Space + L-Click) rather than being alternatives.
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

// Icon + name + description row, using the real HUD SVG glyphs so the legend and
// item lists match the live HUD exactly. Shared by the HUD and Items tabs.
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

// Plain text row aligned with glyphRow but with a typographic marker instead of
// an SVG (e.g. the "✚"/"◆" symbols, or the ?/! detection icons).
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
