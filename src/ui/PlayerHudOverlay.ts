import { MAX_STAMINA, PLAYER_MAX_HEALTH } from '../constants';
import type { CharacterModeId } from '../sprites/characterTypes';
import { createFillableHeart, createHudIcon, type HudIconName } from './hudIcons';
import './playerHud.css';

/**
 * PlayerHudOverlay — the in-game player HUD (health, resources, weapon) over the
 * Phaser canvas.
 *
 * A DOM layer in the same #game parent as the shop/options overlays, but
 * deliberately NOT matched to those pixel-art panels: a modern, minimal,
 * monochrome (black/white/grey) look — hairline translucent panels, SVG glyph
 * icons, hearts/pips for HP/STA, and white-vs-grey state instead of colour
 * accents. GameScene builds a PlayerHudValues snapshot from the live Player each
 * frame and hands it to update(); the overlay holds no gameplay state beyond
 * small per-element dedup caches, so a steady-state frame touches no DOM. The
 * root is pointer-events:none so gameplay input passes through, and it sits below
 * the modal shop/options in the z-order (GameScene hides it on pause so the dim
 * covers it).
 *
 * Why DOM over canvas: layout, alignment, crisp text, and resolution-independent
 * SVG come free from CSS, and the dedup keeps DOM writes off the hot path.
 *
 * Inputs:  the parent DOM host and a per-frame PlayerHudValues snapshot.
 * Outputs: the HUD DOM tree, updated in place only when a value changes.
 * @calledby the gameplay scene, building + ticking the HUD each frame.
 * @calls    the shared HUD icon/heart factories and CSS classes.
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

  // Shows or hides the HUD; GameScene hides it while paused so the dim covers it.
  setVisible(visible: boolean): void {
    if (!this.rootEl) return;
    this.rootEl.style.display = visible ? '' : 'none';
  }

  // Fades the HUD in from transparent; used once on the landing→gameplay transition so HUD and world appear together.
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

  // Removes the DOM node and clears all refs; called on Quit-to-title and HMR teardown.
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

  // Syncs all HUD elements to the snapshot; each sub-update dedup's so a steady-state frame touches no DOM.
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

  // Distributes the HP ratio across the heart row; boundary heart fills fractionally.
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

  // Lights the first `value` STA pips and dims the rest (is-empty); dedup'd on value.
  private updateStamina(value: number): void {
    if (this.lastStamina === value) return;
    this.lastStamina = value;
    for (let i = 0; i < this.staPips.length; i += 1) {
      this.staPips[i].classList.toggle('is-empty', i >= value);
    }
  }

  // Writes a count row's number and dims icon+number when zero; dedup'd, no-op if null.
  private updateCount(row: CountRow | null, current: number): void {
    if (!row || row.lastCount === current) return;
    row.lastCount = current;
    row.count.textContent = String(current);
    const empty = current <= 0;
    row.icon.classList.toggle('is-empty', empty);
    row.count.classList.toggle('is-empty', empty);
  }

  // Updates the weapon glyph+label on mode change and lights the magic tag when magicSelected.
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

  // Builds the three HUD clusters (HP/STA, counts, weapon indicator) and mounts the root.
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

  // Right cluster: G1/G2 ammo + orb/coin/heal counters in an icon|count grid.
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

  // Bottom-left weapon indicator with an inline magic-stance sub-tag.
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

  // Creates a hud-panel div carrying the given modifier class.
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
