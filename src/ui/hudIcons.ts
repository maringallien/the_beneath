/**
 * hudIcons — modern, monochrome HUD icon set authored as inline SVG.
 *
 * The player HUD renders these instead of the old pixel-art / procedural texture
 * icons, so the glyphs are crisp at any size and fully styled from CSS: every
 * shape is painted with `currentColor`, so the surrounding rule controls colour
 * (white = active, translucent = depleted) and opacity with no per-icon state.
 * Glyph geometry is the path data below; a builder emits a fresh <svg> per call
 * (DOM nodes can't be shared between mount points). The underlying game textures
 * (coin / heart / orb / hud_ammo) stay registered for the shop and world drops;
 * only the HUD stops referencing them.
 *
 * Inputs:  an icon name + a CSS class string per build.
 * Outputs: freshly-created SVG/DOM nodes; no shared or retained state.
 * @calledby the player HUD overlay, building its resource/weapon glyph rows.
 * @calls    only the DOM API (createElementNS, attribute setters).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// 24×24 viewBox; single path `d` may hold several sub-paths (nonzero fill = one solid silhouette).
const VIEW_BOX = '0 0 24 24';

export type HudIconName =
  | 'heart' // HP pip
  | 'stamina' // STA pip (lightning bolt)
  | 'coin' // currency counter
  | 'orb' // magic counter + magic-stance tag (mana crystal)
  | 'heal' // heal-item counter (cross)
  | 'gun1' // pistol ammo + weapon indicator (pistol silhouette)
  | 'gun2' // shotgun ammo + weapon indicator (shotgun silhouette)
  | 'sword'; // weapon indicator

// One drawable primitive: a filled path (evenodd to punch holes) or a circle (disc or stroked ring).
type Shape =
  | { readonly tag: 'path'; readonly d: string; readonly fillRule?: 'evenodd' }
  | {
      readonly tag: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly stroke?: number; // present = outlined ring; absent = filled disc
    };

const HEART_D =
  'M12 21C12 21 3.5 14.6 3.5 8.9C3.5 6.3 5.6 4.2 8.2 4.2C9.9 4.2 11.3 5.1 12 6.5' +
  'C12.7 5.1 14.1 4.2 15.8 4.2C18.4 4.2 20.5 6.3 20.5 8.9C20.5 14.6 12 21 12 21Z';

// Lightning bolt — stamina powers the dash, so the meter reads as "energy".
const BOLT_D = 'M7 2V13H10V22L17 10H13L17 2Z';

// Mana crystal — faceted gem matching the magic world pickup.
const CRYSTAL_D = 'M7 5H17L21 10L12 20L3 10Z';

const PLUS_D = 'M10 4H14V10H20V14H14V20H10V14H4V10H10Z';

// Blade (pointed top) + crossguard + grip + pommel as one filled silhouette.
const SWORD_D =
  'M12 2L13.4 5.5V12.5H10.6V5.5Z' +
  'M7.5 12.5H16.5V14H7.5Z' +
  'M11.1 14H12.9V18.5H11.1Z' +
  'M10.4 18.5H13.6V20H10.4Z';

// Compact pistol silhouette (G1) — slide, trigger block, angled rear grip.
const PISTOL_D =
  'M4 6H20V10H4Z' + // slide / barrel
  'M11 10H13.5V12.5H11Z' + // trigger block
  'M5.5 9.5H10L8.5 17H4Z'; // grip (angled, at the rear)

// Long shotgun silhouette (G2) — extended barrel, pump, receiver, butt-stock; unmistakable next to the pistol.
const SHOTGUN_D =
  'M2 6H16V8.5H2Z' + // long barrel
  'M6 8.5H9.5V11H6Z' + // pump / foregrip
  'M13 6H22.5V12.5H19V11H13Z' + // receiver + butt-stock
  'M14.5 11H16.5V14.5H14.5Z'; // trigger grip

// Shape table for every glyph except the coin (which uses the stamped-mask builder).
const ICON_SHAPES: Record<Exclude<HudIconName, 'coin'>, readonly Shape[]> = {
  heart: [{ tag: 'path', d: HEART_D }],
  stamina: [{ tag: 'path', d: BOLT_D }],
  orb: [{ tag: 'path', d: CRYSTAL_D }],
  heal: [{ tag: 'path', d: PLUS_D }],
  gun1: [{ tag: 'path', d: PISTOL_D }],
  gun2: [{ tag: 'path', d: SHOTGUN_D }],
  sword: [{ tag: 'path', d: SWORD_D }],
};

// Appends one shape to the svg as a currentColor path or circle.
function appendShape(svg: SVGSVGElement, shape: Shape): void {
  if (shape.tag === 'path') {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', shape.d);
    path.setAttribute('fill', 'currentColor');
    if (shape.fillRule) path.setAttribute('fill-rule', shape.fillRule);
    svg.appendChild(path);
    return;
  }
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(shape.cx));
  circle.setAttribute('cy', String(shape.cy));
  circle.setAttribute('r', String(shape.r));
  if (shape.stroke !== undefined) {
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', String(shape.stroke));
  } else {
    circle.setAttribute('fill', 'currentColor');
  }
  svg.appendChild(circle);
}

// Creates a blank aria-hidden svg shell with the 24×24 viewBox and the given CSS class.
function baseSvg(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', VIEW_BOX);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  return svg;
}

let coinMaskSeq = 0;
const COIN_STAMP_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
// Draws a solid disc with a "$" knocked out via SVG mask so it reads as a struck coin.
function appendStampedCoin(svg: SVGSVGElement): void {
  coinMaskSeq += 1;
  const maskId = `hud-coin-mask-${coinMaskSeq}`;

  const mask = document.createElementNS(SVG_NS, 'mask');
  mask.setAttribute('id', maskId);
  const body = document.createElementNS(SVG_NS, 'circle');
  body.setAttribute('cx', '12');
  body.setAttribute('cy', '12');
  body.setAttribute('r', '9');
  body.setAttribute('fill', 'white');
  mask.appendChild(body);
  const stamp = document.createElementNS(SVG_NS, 'text');
  stamp.setAttribute('x', '12');
  stamp.setAttribute('y', '12.5');
  stamp.setAttribute('text-anchor', 'middle');
  stamp.setAttribute('dominant-baseline', 'central');
  stamp.setAttribute('font-family', COIN_STAMP_FONT);
  stamp.setAttribute('font-size', '15');
  stamp.setAttribute('font-weight', '700');
  stamp.setAttribute('fill', 'black');
  stamp.textContent = '$';
  mask.appendChild(stamp);

  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.appendChild(mask);
  svg.appendChild(defs);

  const disc = document.createElementNS(SVG_NS, 'circle');
  disc.setAttribute('cx', '12');
  disc.setAttribute('cy', '12');
  disc.setAttribute('r', '9');
  disc.setAttribute('fill', 'currentColor');
  disc.setAttribute('mask', `url(#${maskId})`);
  svg.appendChild(disc);
}

// Returns a fresh svg glyph (new node per call — DOM nodes can't be shared between mount points).
export function createHudIcon(name: HudIconName, className: string): SVGSVGElement {
  const svg = baseSvg(className);
  if (name === 'coin') {
    appendStampedCoin(svg);
    return svg;
  }
  for (const shape of ICON_SHAPES[name]) appendShape(svg, shape);
  return svg;
}

// Builds a two-layer (empty + fill) heart; narrowing the clip span's width shows 0–100% fill from the left.
export function createFillableHeart(): {
  readonly root: HTMLSpanElement;
  readonly clip: HTMLSpanElement;
} {
  const root = document.createElement('span');
  root.className = 'hud-heart';
  root.appendChild(createHudIcon('heart', 'hud-heart-empty'));

  const clip = document.createElement('span');
  clip.className = 'hud-heart-clip';
  clip.appendChild(createHudIcon('heart', 'hud-heart-fill'));
  root.appendChild(clip);

  return { root, clip };
}
