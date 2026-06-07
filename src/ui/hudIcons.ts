// Modern, monochrome HUD icon set authored as inline SVG. The player HUD renders
// these instead of the old pixel-art / procedural texture icons so the glyphs are
// crisp at any size and fully styled from CSS: every shape is painted with
// `currentColor`, so the surrounding rule controls colour (white = active,
// translucent = depleted) and opacity with no per-icon state. The underlying
// game textures (coin / heart / orb / hud_ammo) stay registered for the shop and
// world drops; only the HUD stops referencing them.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Every glyph is authored in a 24×24 box and scaled down by CSS. Filled paths use
// the nonzero rule, so a single `d` may hold several sub-paths (e.g. the sword's
// blade + guard + grip) and still render as one solid silhouette.
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

// One drawable primitive. Most glyphs are a single filled `path`; a path may set
// fillRule:'evenodd' to punch holes (e.g. the coin's engraved rim groove). The
// `circle` form (filled disc or stroked ring) stays available for round shapes.
type Shape =
  | { readonly tag: 'path'; readonly d: string; readonly fillRule?: 'evenodd' }
  | {
      readonly tag: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      // present → outlined ring of this stroke width; absent → filled disc.
      readonly stroke?: number;
    };

const HEART_D =
  'M12 21C12 21 3.5 14.6 3.5 8.9C3.5 6.3 5.6 4.2 8.2 4.2C9.9 4.2 11.3 5.1 12 6.5' +
  'C12.7 5.1 14.1 4.2 15.8 4.2C18.4 4.2 20.5 6.3 20.5 8.9C20.5 14.6 12 21 12 21Z';

// Lightning bolt — stamina powers the dash, so the meter reads as "energy".
const BOLT_D = 'M7 2V13H10V22L17 10H13L17 2Z';

// Mana crystal — a faceted gem (flat table, out to the girdle, down to a pointed
// culet), matching the magic world pickup. Distinct from the round coin.
const CRYSTAL_D = 'M7 5H17L21 10L12 20L3 10Z';

const PLUS_D = 'M10 4H14V10H20V14H14V20H10V14H4V10H10Z';

// Blade (pointed top) + crossguard + grip + pommel as one filled silhouette.
const SWORD_D =
  'M12 2L13.4 5.5V12.5H10.6V5.5Z' +
  'M7.5 12.5H16.5V14H7.5Z' +
  'M11.1 14H12.9V18.5H11.1Z' +
  'M10.4 18.5H13.6V20H10.4Z';

// Pistol silhouette (G1) — compact: a short horizontal slide, a small trigger
// block, and a grip angling down from the rear. Showing the two ammo counters as
// different *weapons* (compact pistol vs long shotgun) separates them at a glance
// far better than the two near-identical cartridges did.
const PISTOL_D =
  'M4 6H20V10H4Z' + // slide / barrel
  'M11 10H13.5V12.5H11Z' + // trigger block
  'M5.5 9.5H10L8.5 17H4Z'; // grip (angled, at the rear)

// Shotgun silhouette (G2) — a long gun: an extended barrel with an under-pump, a
// receiver, a trigger grip, and a butt-stock at the rear. Its long horizontal
// outline is unmistakable next to the compact pistol.
const SHOTGUN_D =
  'M2 6H16V8.5H2Z' + // long barrel
  'M6 8.5H9.5V11H6Z' + // pump / foregrip
  'M13 6H22.5V12.5H19V11H13Z' + // receiver + butt-stock
  'M14.5 11H16.5V14.5H14.5Z'; // trigger grip

// Every glyph except the coin is one or more filled paths. The coin is built
// specially (a "$" stamped into a solid disc — see appendStampedCoin).
const ICON_SHAPES: Record<Exclude<HudIconName, 'coin'>, readonly Shape[]> = {
  heart: [{ tag: 'path', d: HEART_D }],
  stamina: [{ tag: 'path', d: BOLT_D }],
  orb: [{ tag: 'path', d: CRYSTAL_D }],
  heal: [{ tag: 'path', d: PLUS_D }],
  gun1: [{ tag: 'path', d: PISTOL_D }],
  gun2: [{ tag: 'path', d: SHOTGUN_D }],
  sword: [{ tag: 'path', d: SWORD_D }],
};

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

function baseSvg(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', VIEW_BOX);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  return svg;
}

// Stamped "$" coin: a solid currentColor disc with a dollar sign knocked out via
// an SVG mask (white disc = visible, black "$" = transparent), so the symbol
// reads as a dark stamp on the coin against the HUD's dark panel — a struck coin
// that matches the solid fill of the other glyphs. The mask id is made unique per
// instance so coins never share one mask.
let coinMaskSeq = 0;
const COIN_STAMP_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
function appendStampedCoin(svg: SVGSVGElement): void {
  coinMaskSeq += 1;
  const maskId = `hud-coin-mask-${coinMaskSeq}`;

  const mask = document.createElementNS(SVG_NS, 'mask');
  mask.setAttribute('id', maskId);
  const body = document.createElementNS(SVG_NS, 'circle');
  body.setAttribute('cx', '12');
  body.setAttribute('cy', '12');
  body.setAttribute('r', '9');
  body.setAttribute('fill', 'white'); // visible coin body
  mask.appendChild(body);
  const stamp = document.createElementNS(SVG_NS, 'text');
  stamp.setAttribute('x', '12');
  stamp.setAttribute('y', '12.5');
  stamp.setAttribute('text-anchor', 'middle');
  stamp.setAttribute('dominant-baseline', 'central');
  stamp.setAttribute('font-family', COIN_STAMP_FONT);
  stamp.setAttribute('font-size', '15');
  stamp.setAttribute('font-weight', '700');
  stamp.setAttribute('fill', 'black'); // knocked-out dollar sign
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

// Builds a fresh <svg> glyph for the given icon. A new node is returned each call
// (DOM nodes can't be shared between mount points, and the heart row needs many
// independent copies). `className` is applied to the root for CSS sizing + colour.
export function createHudIcon(name: HudIconName, className: string): SVGSVGElement {
  const svg = baseSvg(className);
  if (name === 'coin') {
    appendStampedCoin(svg);
    return svg;
  }
  for (const shape of ICON_SHAPES[name]) appendShape(svg, shape);
  return svg;
}

// A heart that can render a partial fill, built with the classic "rating" clip:
// a grey "empty" heart sits in flow, and a white "fill" heart of fixed width is
// overlaid inside an absolutely-positioned, overflow-hidden clip span. Narrowing
// that span's width (set by the HUD per frame) reveals 0–100% of the heart from
// the left. Returns the root plus the clip span whose width the caller animates.
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
