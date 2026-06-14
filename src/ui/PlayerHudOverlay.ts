import { MAX_STAMINA, PLAYER_MAX_HEALTH } from '../constants';
import type { CharacterModeId } from '../sprites/characterTypes';
import { createFillableHeart, createHudIcon, type HudIconName } from './hudIcons';
import './playerHud.css';

/**
 * @file ui/PlayerHudOverlay.ts
 * @description In-game player HUD (health, resources, weapon) as a DOM layer over the Phaser canvas — deliberately modern monochrome, not the pixel-art panels; fed a PlayerHudValues snapshot each frame and dedup'd per element so a steady-state frame touches no DOM; pointer-events none so input passes through.
 * @module ui
 */
// Per-frame snapshot of player resources for the HUD; max* fields are part of the GameScene contract even if not all are used.
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
  // Active wheel weapon + magic-stance flag; together drive the bottom-left weapon indicator.
  readonly mode: CharacterModeId;
  readonly magicSelected: boolean;
}

// HP shown as a fixed heart row; boundary heart fills fractionally.
const HP_PER_HEART = 20;
const HEART_COUNT = Math.max(1, Math.round(PLAYER_MAX_HEALTH / HP_PER_HEART)); // 5
const STAMINA_PIP_COUNT = MAX_STAMINA; // one pip per stamina point

// Short label + icon for each wheel mode (same silhouettes as the ammo counter icons).
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

// One right-column icon+count row; dedup cache so DOM is only touched when the value changes.
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

export class PlayerHudOverlay {
  private readonly parent: HTMLElement;

  private rootEl: HTMLDivElement | null = null;

  private heartClips: HTMLElement[] = []; // clip span widths = per-heart fill fraction
  private lastHpRatio = -1;

  private staPips: SVGSVGElement[] = [];
  private lastStamina = -1;

  private gun1: CountRow | null = null;
  private gun2: CountRow | null = null;
  private orbRow: CountRow | null = null;
  private coinRow: CountRow | null = null;
  private healRow: CountRow | null = null;

  // Weapon/stance indicator refs; all null until buildWeaponPanel runs.
  private weaponIconWrap: HTMLElement | null = null;
  private weaponLabel: HTMLSpanElement | null = null;
  private weaponMagicTag: HTMLElement | null = null;
  private lastWeaponMode: CharacterModeId | null = null;
  private lastMagicSelected: boolean | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.buildDom();
  }

  /** Show or hide the HUD; hidden while the scene is paused so the dim covers it. */
  setVisible(visible: boolean): void {
    if (!this.rootEl) return;
    this.rootEl.style.display = visible ? '' : 'none';
  }

  /**
   * @function    fadeIn
   * @description Fade the HUD in from transparent (one-shot opacity transition that clears its inline styles when done) so HUD and world appear together on the landing-to-gameplay transition.
   * @param   durationMs  Fade duration in milliseconds.
   * @calledby src/scenes/gameHud.ts → fadeIn, on the landing-into-gameplay transition
   * @calls    a forced reflow and a CSS opacity transition (transitionend cleanup)
   */
  fadeIn(durationMs: number): void {
    const el = this.rootEl;
    if (!el) return;
    el.style.display = '';
    el.style.transition = 'none';
    el.style.opacity = '0';
    void el.offsetWidth; // forced reflow so opacity:0 is the animation's start frame
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

  /**
   * @function    destroy
   * @description Remove the DOM node and clear every cached element reference.
   * @calledby src/scenes/gameHud.ts → destroy / destroyForSceneShutdown (Quit-to-title and hot-reload teardown)
   * @calls    DOM element removal only
   */
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

  /**
   * @function    update
   * @description Sync HP, stamina, every count row, and the weapon indicator to the snapshot; each sub-update dedup's so a steady-state frame touches no DOM. No-op if not mounted.
   * @param   values  Per-frame PlayerHudValues snapshot from GameScene.
   * @calledby src/scenes/gameHud.ts → updateHud, each gameplay frame
   * @calls    src/ui/PlayerHudOverlay.ts → updateHp, updateStamina, updateCount, updateWeapon
   */
  update(values: PlayerHudValues): void {
    if (!this.rootEl) return;
    this.updateHp(values.health, values.maxHealth);
    this.updateStamina(values.stamina);
    this.updateCount(this.gun1, values.gun1Ammo);
    this.updateCount(this.gun2, values.gun2Ammo);
    this.updateCount(this.orbRow, values.magic);
    this.updateCount(this.coinRow, values.coins);
    this.updateCount(this.healRow, values.healItems);
    this.updateWeapon(values.mode, values.magicSelected);
  }

  /**
   * @function    updateHp
   * @description Distribute the HP ratio across the heart row (boundary heart fills fractionally), setting each heart's clip width; dedup'd, no-op if the ratio is unchanged.
   * @param   health     Current HP.
   * @param   maxHealth  Max HP; guards divide-by-zero.
   * @calledby src/ui/PlayerHudOverlay.ts → update
   * @calls    src/ui/PlayerHudOverlay.ts → clamp01 and DOM style writes only
   */
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

  /**
   * @function    updateStamina
   * @description Light the first `value` STA pips and dim the rest (is-empty); dedup'd on value.
   * @param   value  Current stamina count.
   * @calledby src/ui/PlayerHudOverlay.ts → update
   * @calls    DOM classList toggles only
   */
  private updateStamina(value: number): void {
    if (this.lastStamina === value) return;
    this.lastStamina = value;
    for (let i = 0; i < this.staPips.length; i += 1) {
      this.staPips[i].classList.toggle('is-empty', i >= value);
    }
  }

  /**
   * @function    updateCount
   * @description Write a count row's number and dim icon+number when zero; dedup'd, no-op if the row is null or the value is unchanged.
   * @param   row      Count row handle, or null.
   * @param   current  Value to display.
   * @calledby src/ui/PlayerHudOverlay.ts → update, for each resource counter (ammo, orbs, coins, heal)
   * @calls    DOM text/classList writes only
   */
  private updateCount(row: CountRow | null, current: number): void {
    if (!row || row.lastCount === current) return;
    row.lastCount = current;
    row.count.textContent = String(current);
    const empty = current <= 0;
    row.icon.classList.toggle('is-empty', empty);
    row.count.classList.toggle('is-empty', empty);
  }

  /**
   * @function    updateWeapon
   * @description Swap the weapon glyph/label on mode change and toggle the magic-stance tag when magicSelected; dedup'd on each.
   * @param   mode           Active wheel weapon.
   * @param   magicSelected  Whether the magic stance is on.
   * @calledby src/ui/PlayerHudOverlay.ts → update
   * @calls    src/ui/hudIcons.ts → createHudIcon and DOM text/style/classList writes
   */
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

  /**
   * @function    buildDom
   * @description Build the three HUD clusters (HP/STA, counts, weapon indicator), append the root to the parent, and record its ref.
   * @calledby src/ui/PlayerHudOverlay.ts → constructor
   * @calls    src/ui/PlayerHudOverlay.ts → buildLeftPanel, buildRightPanel, buildWeaponPanel, and DOM append
   */
  private buildDom(): void {
    const root = document.createElement('div');
    root.className = 'player-hud';
    root.appendChild(this.buildLeftPanel());
    root.appendChild(this.buildRightPanel());
    root.appendChild(this.buildWeaponPanel());
    this.parent.appendChild(root);
    this.rootEl = root;
  }

  /**
   * @function    buildLeftPanel
   * @description Build the left cluster — a row of HP hearts above a row of STA pips — recording the heart-clip and stamina-pip refs for updates.
   * @returns a detached left panel.
   * @calledby src/ui/PlayerHudOverlay.ts → buildDom
   * @calls    src/ui/hudIcons.ts → createFillableHeart and createHudIcon
   */
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

  /**
   * @function    buildRightPanel
   * @description Build the right cluster — G1/G2 ammo + orb/coin/heal counters in an icon-and-count grid — recording each count-row handle for updates.
   * @returns a detached right panel.
   * @calledby src/ui/PlayerHudOverlay.ts → buildDom
   * @calls    src/ui/PlayerHudOverlay.ts → addCountRow, once per resource
   */
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

  /**
   * @function    buildWeaponPanel
   * @description Build the bottom-left weapon indicator with an inline magic-stance sub-tag, recording the icon-wrap, label, and magic-tag refs for updates.
   * @returns a detached weapon panel.
   * @calledby src/ui/PlayerHudOverlay.ts → buildDom
   * @calls    src/ui/hudIcons.ts → createHudIcon and DOM element creation
   */
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

  /** Create a hud-panel div carrying the given modifier class. */
  private makePanel(modifier: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = `hud-panel ${modifier}`;
    return panel;
  }

  /**
   * @function    addCountRow
   * @description Append an [icon, count] pair to the right grid and return the CountRow handle (lastCount seeded to -1) for later updates.
   * @param   grid  Right-panel grid to append into.
   * @param   icon  Which HUD glyph to draw.
   * @returns the CountRow handle.
   * @calledby src/ui/PlayerHudOverlay.ts → buildRightPanel, once per resource
   * @calls    src/ui/hudIcons.ts → createHudIcon and DOM append
   */
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
