import Phaser from 'phaser';
import {
  COIN_TEXTURE_KEY,
  HEART_TEXTURE_KEY,
  MAGIC_ORB_TEXTURE_KEY,
} from '../constants';
import { drawTextureFrame, frameCanvas } from './textureCanvas';
import './playerHud.css';

// Snapshot of the player resources the HUD renders. GameScene builds one of
// these each frame from the live Player and hands it to update(); the overlay
// holds no gameplay state beyond the small per-element dedup caches that keep
// DOM writes off the hot path when nothing changed.
export interface PlayerHudValues {
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly magic: number;
  readonly maxMagic: number;
  readonly gun1Ammo: number;
  readonly maxGun1Ammo: number;
  readonly gun2Ammo: number;
  readonly maxGun2Ammo: number;
  readonly coins: number;
  readonly maxCoins: number;
  readonly healItems: number;
  readonly maxHealItems: number;
}

// Texture keys + frames mirrored from the art pipeline (registered in
// PreloadScene); kept local since they're presentation details of the HUD.
const HP_SLIDER_TEXTURE_KEY = 'hud_sliders';
// sliders.png row 0 holds 10 fill levels (frame 0 = empty … 9 = full).
const HP_SLIDER_FRAME_COUNT = 10;
const STAMINA_TEXTURE_KEY = 'hud_stamina';
// STA ships as three independent segment frames named seg0..seg2; stamina maxes
// at 3, so the count of lit segments equals the current value. (Magic used to
// share this meter shape; it is now a counted orb inventory in the right
// cluster — see the orb CountRow below.)
const SEGMENT_COUNT = 3;
const AMMO_TEXTURE_KEY = 'hud_ammo';
// hud_ammo grid: frame 0 = pistol bullet (G1), frame 12 = shotgun shell (G2).
const GUN1_ICON_FRAME = 0;
const GUN2_ICON_FRAME = 12;

// Opacity for a drained STA/MAG segment — faded rather than hidden so the
// meter's full footprint stays put and empty pips read as "slots".
const SEGMENT_EMPTY_OPACITY = '0.18';
const SEGMENT_FULL_OPACITY = '1';
// Right-column icon dim when its resource is at zero (out of ammo / no coins /
// no heals) — mirrors the old canvas HUD's empty-icon fade.
const ICON_EMPTY_OPACITY = '0.35';
const ICON_FULL_OPACITY = '1';

// One right-column row: an icon + its "x N" count, with a dedup cache so the
// DOM is only rewritten when the count actually changes.
interface CountRow {
  readonly icon: HTMLCanvasElement;
  readonly count: HTMLSpanElement;
  lastCount: number;
}

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

// DOM-based player HUD rendered over the Phaser canvas inside the same #game
// parent as the shop/options overlays, styled to match them (dark flat panels,
// thin frame, pixel corner accents). Two clusters: HP / STA top-left, and the
// G1 / G2 / orb / coin / heal counters top-right.
//
// Why DOM over canvas: layout, alignment, and crisp text come for free from
// CSS, and the per-element dedup below means the DOM is only touched when a
// value actually changes — lighter than the previous per-frame world-space
// repositioning of ~15 Phaser game objects. The root is pointer-events:none so
// gameplay input (L-click to fire, etc.) passes straight through, and it sits
// below the modal shop/options overlays in the z-order. GameScene toggles
// visibility on scene pause so it's covered by the pause/shop dim.
export class PlayerHudOverlay {
  private readonly scene: Phaser.Scene;
  private readonly parent: HTMLElement;

  private rootEl: HTMLDivElement | null = null;

  // HP slider canvas + last-rendered frame index (frame swaps on ratio change).
  private hpCanvas: HTMLCanvasElement | null = null;
  private lastHpFrame = -1;

  // STA segment canvases + last value (drives per-segment opacity).
  private staSegments: HTMLCanvasElement[] = [];
  private lastStamina = -1;

  private gun1: CountRow | null = null;
  private gun2: CountRow | null = null;
  private orbRow: CountRow | null = null;
  private coinRow: CountRow | null = null;
  private healRow: CountRow | null = null;

  constructor(scene: Phaser.Scene, parent: HTMLElement) {
    this.scene = scene;
    this.parent = parent;
    this.buildDom();
  }

  // Show/hide the whole HUD. GameScene hides it while the scene is paused (pause
  // menu, shop, options) so the DOM HUD is covered by the dim instead of
  // floating above it.
  setVisible(visible: boolean): void {
    if (!this.rootEl) return;
    this.rootEl.style.display = visible ? '' : 'none';
  }

  // Ramps the whole HUD up from transparent over durationMs. Used once, when the
  // world reveals after the landing → gameplay transition: GameScene keeps the
  // HUD hidden under the black hold, then calls this as the camera fades in so
  // the HUD and world appear together instead of the HUD popping in first.
  //
  // The forced reflow commits display+opacity:0 as the transition's start frame
  // (needed because we may be coming back from display:none, which otherwise has
  // no frame to animate from). The inline transition/opacity are cleared once
  // the fade ends so later setVisible() display toggles stay instant.
  fadeIn(durationMs: number): void {
    const el = this.rootEl;
    if (!el) return;
    el.style.display = '';
    el.style.transition = 'none';
    el.style.opacity = '0';
    void el.offsetWidth;
    el.style.transition = `opacity ${durationMs}ms ease-out`;
    el.style.opacity = '1';
    el.addEventListener(
      'transitionend',
      () => {
        el.style.transition = '';
        el.style.opacity = '';
      },
      { once: true },
    );
  }

  // Removes the DOM node and clears references. Called on Quit-to-title and on
  // HMR teardown — mirrors ShopOverlay.destroy().
  destroy(): void {
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    this.hpCanvas = null;
    this.staSegments = [];
    this.gun1 = null;
    this.gun2 = null;
    this.orbRow = null;
    this.coinRow = null;
    this.healRow = null;
  }

  // Syncs every element to the supplied values. Each sub-update early-returns
  // when its cached value is unchanged, so a steady-state frame touches no DOM.
  update(values: PlayerHudValues): void {
    if (!this.rootEl) return;
    this.updateHp(values.health, values.maxHealth);
    this.updateStaminaSegments(values.stamina);
    this.updateCount(this.gun1, values.gun1Ammo);
    this.updateCount(this.gun2, values.gun2Ammo);
    // `values.magic` is the carried orb count (capped at MAX_MAGIC); rendered
    // as an icon + count now rather than a segment bar.
    this.updateCount(this.orbRow, values.magic);
    this.updateCount(this.coinRow, values.coins);
    this.updateCount(this.healRow, values.healItems);
  }

  private updateHp(health: number, maxHealth: number): void {
    if (!this.hpCanvas) return;
    const ratio = clamp01(maxHealth > 0 ? health / maxHealth : 0);
    const frame = Phaser.Math.Clamp(
      Math.floor(ratio * HP_SLIDER_FRAME_COUNT),
      0,
      HP_SLIDER_FRAME_COUNT - 1,
    );
    if (frame === this.lastHpFrame) return;
    this.lastHpFrame = frame;
    drawTextureFrame(this.hpCanvas, this.scene, HP_SLIDER_TEXTURE_KEY, frame);
  }

  private updateStaminaSegments(value: number): void {
    if (this.lastStamina === value) return;
    this.lastStamina = value;
    for (let i = 0; i < this.staSegments.length; i += 1) {
      this.staSegments[i].style.opacity =
        i < value ? SEGMENT_FULL_OPACITY : SEGMENT_EMPTY_OPACITY;
    }
  }

  private updateCount(row: CountRow | null, current: number): void {
    if (!row || row.lastCount === current) return;
    row.lastCount = current;
    row.count.textContent = `x ${current}`;
    row.icon.style.opacity =
      current > 0 ? ICON_FULL_OPACITY : ICON_EMPTY_OPACITY;
  }

  private buildDom(): void {
    const root = document.createElement('div');
    root.className = 'player-hud';
    root.appendChild(this.buildLeftPanel());
    root.appendChild(this.buildRightPanel());
    this.parent.appendChild(root);
    this.rootEl = root;
  }

  // Left cluster: HP slider, then the STA segment meter, in a 2-column
  // [label | content] grid. (Magic moved to the right cluster as an orb
  // counter; see buildRightPanel.)
  private buildLeftPanel(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'hud-grid hud-grid--left';

    grid.appendChild(this.buildLabel('HP'));
    this.hpCanvas = frameCanvas(
      this.scene,
      HP_SLIDER_TEXTURE_KEY,
      HP_SLIDER_FRAME_COUNT - 1,
    );
    this.hpCanvas.className = 'hud-bar hud-bar--hp';
    this.lastHpFrame = HP_SLIDER_FRAME_COUNT - 1;
    grid.appendChild(this.hpCanvas);

    grid.appendChild(this.buildLabel('STA', true));
    const sta = this.buildSegments(STAMINA_TEXTURE_KEY);
    this.staSegments = sta.segments;
    grid.appendChild(sta.wrapper);

    return this.wrapPanel(grid, 'hud-panel--left');
  }

  // Right cluster: G1 / G2 ammo, then the orb / coin / heal counters, in a
  // 3-column [label | icon | count] grid. The orb/coin/heal rows use an empty
  // label cell (the icon is unambiguous) but still occupy the column so every
  // icon stays aligned. The orb (magic) icon samples smoothly like coin/heal.
  private buildRightPanel(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'hud-grid hud-grid--right';

    this.gun1 = this.buildCountRow(grid, 'G1', AMMO_TEXTURE_KEY, GUN1_ICON_FRAME, true);
    this.gun2 = this.buildCountRow(grid, 'G2', AMMO_TEXTURE_KEY, GUN2_ICON_FRAME, true);
    this.orbRow = this.buildCountRow(grid, '', MAGIC_ORB_TEXTURE_KEY, undefined, false);
    this.coinRow = this.buildCountRow(grid, '', COIN_TEXTURE_KEY, undefined, false);
    this.healRow = this.buildCountRow(grid, '', HEART_TEXTURE_KEY, undefined, false);

    return this.wrapPanel(grid, 'hud-panel--right');
  }

  private wrapPanel(grid: HTMLDivElement, modifier: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = `hud-panel ${modifier}`;
    panel.appendChild(grid);
    return panel;
  }

  private buildLabel(text: string, small = false): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = small ? 'hud-label hud-label--small' : 'hud-label';
    span.textContent = text;
    return span;
  }

  private buildSegments(textureKey: string): {
    wrapper: HTMLDivElement;
    segments: HTMLCanvasElement[];
  } {
    const wrapper = document.createElement('div');
    wrapper.className = 'hud-segments';
    const segments: HTMLCanvasElement[] = [];
    for (let i = 0; i < SEGMENT_COUNT; i += 1) {
      const seg = frameCanvas(this.scene, textureKey, `seg${i}`);
      seg.className = 'hud-seg';
      wrapper.appendChild(seg);
      segments.push(seg);
    }
    return { wrapper, segments };
  }

  // Appends a [label, icon, count] triple to the right grid and returns the
  // CountRow handle for later updates. `pixelArt` picks nearest-neighbour vs
  // smooth scaling (procedural coin/heart sample smoothly, ammo stays crisp).
  private buildCountRow(
    grid: HTMLDivElement,
    labelText: string,
    textureKey: string,
    frame: number | undefined,
    pixelArt: boolean,
  ): CountRow {
    grid.appendChild(this.buildLabel(labelText));

    const icon = frameCanvas(this.scene, textureKey, frame);
    icon.className = pixelArt ? 'hud-icon' : 'hud-icon hud-icon--smooth';
    grid.appendChild(icon);

    const count = document.createElement('span');
    count.className = 'hud-count';
    count.textContent = 'x 0';
    grid.appendChild(count);

    return { icon, count, lastCount: -1 };
  }
}
