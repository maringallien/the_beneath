import { MAX_STAMINA, PLAYER_MAX_HEALTH } from '../constants';
import type { CharacterModeId } from '../sprites/characterTypes';
import { createFillableHeart, createHudIcon, type HudIconName } from './hudIcons';
import './playerHud.css';

// Snapshot of the player resources the HUD renders. GameScene builds one of these
// each frame from the live Player and hands it to update(); the overlay holds no
// gameplay state beyond the small per-element dedup caches that keep DOM writes
// off the hot path when nothing changed. (Several `max*` fields are part of the
// stable contract with GameScene even though the monochrome HUD only needs a
// subset — health uses its max for the heart ratio; the counters render raw
// values.)
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
  // Active wheel weapon and whether the sword magic stance is selected; together
  // they drive the bottom-left weapon indicator (see updateWeapon).
  readonly mode: CharacterModeId;
  readonly magicSelected: boolean;
}

// HP is a 0–100 pool (PLAYER_MAX_HEALTH); we show it as a fixed row of hearts,
// each worth HP_PER_HEART, with the boundary heart filling fractionally. Deriving
// the count keeps the row correct if the max ever changes.
const HP_PER_HEART = 20;
const HEART_COUNT = Math.max(1, Math.round(PLAYER_MAX_HEALTH / HP_PER_HEART)); // 5
// Stamina is a small discrete pool, shown as one diamond pip per point.
const STAMINA_PIP_COUNT = MAX_STAMINA; // 3

// Bottom-left weapon indicator: each wheel mode's short label + the icon glyph
// used beside it (the sword/pistol/shotgun silhouettes double as the G1/G2 ammo
// icons in the right cluster).
const WEAPON_LABELS: Record<CharacterModeId, string> = {
  sword_master: 'SWORD',
  gunslinger_gun1: 'GUN 1',
  gunslinger_gun2: 'GUN 2',
};
const WEAPON_ICONS: Record<CharacterModeId, HudIconName> = {
  sword_master: 'sword',
  gunslinger_gun1: 'gun1',
  gunslinger_gun2: 'gun2',
};

// One right-column row: an icon + its numeric count, with a dedup cache so the DOM
// is only rewritten when the count actually changes. `is-empty` dims both the icon
// and the number when the resource hits zero.
interface CountRow {
  readonly icon: SVGSVGElement;
  readonly count: HTMLSpanElement;
  lastCount: number;
}

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

// DOM-based player HUD rendered over the Phaser canvas inside the same #game
// parent as the shop/options overlays. Deliberately *not* matched to those
// pixel-art panels: this is a modern, minimal, monochrome (black/white/grey)
// layer — hairline translucent panels, SVG glyph icons, hearts/pips for HP/STA,
// and white-vs-grey state instead of colour accents.
//
// Why DOM over canvas: layout, alignment, crisp text and resolution-independent
// SVG come for free from CSS, and the per-element dedup below means the DOM is
// only touched when a value actually changes. The root is pointer-events:none so
// gameplay input (L-click to fire, etc.) passes straight through, and it sits
// below the modal shop/options overlays in the z-order. GameScene toggles
// visibility on scene pause so it's covered by the pause/shop dim.
export class PlayerHudOverlay {
  private readonly parent: HTMLElement;

  private rootEl: HTMLDivElement | null = null;

  // HP heart clip spans (their width = each heart's fill fraction) + last ratio.
  private heartClips: HTMLElement[] = [];
  private lastHpRatio = -1;

  // STA diamond pips + last value (drives per-pip is-empty).
  private staPips: SVGSVGElement[] = [];
  private lastStamina = -1;

  private gun1: CountRow | null = null;
  private gun2: CountRow | null = null;
  private orbRow: CountRow | null = null;
  private coinRow: CountRow | null = null;
  private healRow: CountRow | null = null;

  // Weapon/stance indicator (bottom-left). Independent dedup caches keep its DOM
  // writes off the hot path; all null until buildWeaponPanel runs.
  private weaponIconWrap: HTMLElement | null = null;
  private weaponLabel: HTMLSpanElement | null = null;
  private weaponMagicTag: HTMLElement | null = null;
  private lastWeaponMode: CharacterModeId | null = null;
  private lastMagicSelected: boolean | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.buildDom();
  }

  // Show/hide the whole HUD. GameScene hides it while the scene is paused (pause
  // menu, shop, options) so the DOM HUD is covered by the dim instead of floating
  // above it.
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
  // no frame to animate from). The inline transition/opacity are cleared once the
  // fade ends so later setVisible() display toggles stay instant.
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

  // Removes the DOM node and clears references. Called on Quit-to-title and on HMR
  // teardown — mirrors ShopOverlay.destroy().
  destroy(): void {
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    this.heartClips = [];
    this.staPips = [];
    this.gun1 = null;
    this.gun2 = null;
    this.orbRow = null;
    this.coinRow = null;
    this.healRow = null;
    this.weaponIconWrap = null;
    this.weaponLabel = null;
    this.weaponMagicTag = null;
  }

  // Syncs every element to the supplied values. Each sub-update early-returns when
  // its cached value is unchanged, so a steady-state frame touches no DOM.
  update(values: PlayerHudValues): void {
    if (!this.rootEl) return;
    this.updateHp(values.health, values.maxHealth);
    this.updateStamina(values.stamina);
    this.updateCount(this.gun1, values.gun1Ammo);
    this.updateCount(this.gun2, values.gun2Ammo);
    // `values.magic` is the carried orb count (capped at the player's current orb
    // cap); rendered as an icon + count alongside the other inventories.
    this.updateCount(this.orbRow, values.magic);
    this.updateCount(this.coinRow, values.coins);
    this.updateCount(this.healRow, values.healItems);
    this.updateWeapon(values.mode, values.magicSelected);
  }

  // Distributes the HP ratio across the heart row: heart i fills clamp(ratio*N - i)
  // of the way, so a single boundary heart renders the fractional remainder while
  // the rest are full or empty. Dedup on the ratio keeps it off the hot path.
  private updateHp(health: number, maxHealth: number): void {
    const ratio = clamp01(maxHealth > 0 ? health / maxHealth : 0);
    if (ratio === this.lastHpRatio) return;
    this.lastHpRatio = ratio;
    const filledHearts = ratio * HEART_COUNT;
    for (let i = 0; i < this.heartClips.length; i += 1) {
      const fill = clamp01(filledHearts - i);
      this.heartClips[i].style.width = `${fill * 100}%`;
    }
  }

  private updateStamina(value: number): void {
    if (this.lastStamina === value) return;
    this.lastStamina = value;
    for (let i = 0; i < this.staPips.length; i += 1) {
      this.staPips[i].classList.toggle('is-empty', i >= value);
    }
  }

  private updateCount(row: CountRow | null, current: number): void {
    if (!row || row.lastCount === current) return;
    row.lastCount = current;
    row.count.textContent = String(current);
    const empty = current <= 0;
    row.icon.classList.toggle('is-empty', empty);
    row.count.classList.toggle('is-empty', empty);
  }

  // Bottom-left weapon + stance indicator. Two independent dedup caches: the wheel
  // `mode` swaps the weapon glyph + label; `magicSelected` lights the magic tag.
  // The magic tag only shows in sword_master (hidden in gun modes, where
  // magicSelected is always false anyway), grey when the stance is off and white
  // (with a one-shot pulse) when on. A steady-state frame touches no DOM.
  private updateWeapon(mode: CharacterModeId, magicSelected: boolean): void {
    if (this.lastWeaponMode !== mode) {
      this.lastWeaponMode = mode;
      if (this.weaponLabel) this.weaponLabel.textContent = WEAPON_LABELS[mode];
      if (this.weaponIconWrap) {
        this.weaponIconWrap.replaceChildren(
          createHudIcon(WEAPON_ICONS[mode], 'hud-weapon-glyph'),
        );
      }
      if (this.weaponMagicTag) {
        this.weaponMagicTag.style.display = mode === 'sword_master' ? '' : 'none';
      }
    }
    if (this.weaponMagicTag && this.lastMagicSelected !== magicSelected) {
      this.lastMagicSelected = magicSelected;
      this.weaponMagicTag.classList.toggle('is-active', magicSelected);
    }
  }

  private buildDom(): void {
    const root = document.createElement('div');
    root.className = 'player-hud';
    root.appendChild(this.buildLeftPanel());
    root.appendChild(this.buildRightPanel());
    root.appendChild(this.buildWeaponPanel());
    this.parent.appendChild(root);
    this.rootEl = root;
  }

  // Left cluster: a row of HP hearts above a row of STA diamond pips.
  private buildLeftPanel(): HTMLDivElement {
    const panel = this.makePanel('hud-panel--left');

    const hp = document.createElement('div');
    hp.className = 'hud-meter';
    for (let i = 0; i < HEART_COUNT; i += 1) {
      const heart = createFillableHeart();
      hp.appendChild(heart.root);
      this.heartClips.push(heart.clip);
    }
    panel.appendChild(hp);

    const sta = document.createElement('div');
    sta.className = 'hud-meter';
    for (let i = 0; i < STAMINA_PIP_COUNT; i += 1) {
      const pip = createHudIcon('stamina', 'hud-pip');
      sta.appendChild(pip);
      this.staPips.push(pip);
    }
    panel.appendChild(sta);

    return panel;
  }

  // Right cluster: G1 / G2 ammo, then the orb / coin / heal counters, laid out as
  // an [icon | count] grid so every icon and every number stays column-aligned.
  private buildRightPanel(): HTMLDivElement {
    const panel = this.makePanel('hud-panel--right');
    const grid = document.createElement('div');
    grid.className = 'hud-grid';

    this.gun1 = this.addCountRow(grid, 'gun1');
    this.gun2 = this.addCountRow(grid, 'gun2');
    this.orbRow = this.addCountRow(grid, 'orb');
    this.coinRow = this.addCountRow(grid, 'coin');
    this.healRow = this.addCountRow(grid, 'heal');

    panel.appendChild(grid);
    return panel;
  }

  // Bottom-left indicator showing the active wheel weapon, with the sword magic
  // stance as a sub-tag. The weapon glyph is (re)built by updateWeapon; the magic
  // tag lights via the is-active class.
  private buildWeaponPanel(): HTMLDivElement {
    const panel = this.makePanel('hud-panel--weapon');
    const row = document.createElement('div');
    row.className = 'hud-weapon';

    this.weaponIconWrap = document.createElement('span');
    this.weaponIconWrap.className = 'hud-weapon-icon';
    row.appendChild(this.weaponIconWrap);

    this.weaponLabel = document.createElement('span');
    this.weaponLabel.className = 'hud-weapon-label';
    row.appendChild(this.weaponLabel);

    const magicTag = document.createElement('span');
    magicTag.className = 'hud-weapon-magic';
    magicTag.appendChild(createHudIcon('orb', 'hud-weapon-magic-icon'));
    const magicText = document.createElement('span');
    magicText.className = 'hud-weapon-magic-text';
    magicText.textContent = 'MAGIC';
    magicTag.appendChild(magicText);
    row.appendChild(magicTag);
    this.weaponMagicTag = magicTag;

    panel.appendChild(row);
    return panel;
  }

  private makePanel(modifier: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = `hud-panel ${modifier}`;
    return panel;
  }

  // Appends an [icon, count] pair to the right grid and returns the CountRow handle
  // for later updates.
  private addCountRow(grid: HTMLDivElement, icon: HudIconName): CountRow {
    const iconEl = createHudIcon(icon, 'hud-icon');
    grid.appendChild(iconEl);

    const count = document.createElement('span');
    count.className = 'hud-count';
    count.textContent = '0';
    grid.appendChild(count);

    return { icon: iconEl, count, lastCount: -1 };
  }
}
