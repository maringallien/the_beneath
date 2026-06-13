import type Phaser from 'phaser';
import {
  OPTIONS_SOUND_OFF_ICON_PATH,
  OPTIONS_SOUND_ON_ICON_PATH,
} from '../constants';
import { getMusicVolume, setMusicVolume, toggleMusicMuted } from '../audio';
import { DomOverlay } from './DomOverlay';
import './shop.css';
import './options.css';
import './manual.css';
import type { ManualSection, SectionBuilder } from './manual/manualSection';
import { buildBasicsSection } from './manual/sections/basicsSection';
import { buildControlsSection } from './manual/sections/controlsSection';
import { buildCombatSection } from './manual/sections/combatSection';
import { buildHudSection } from './manual/sections/hudSection';
import { buildEnemiesSection } from './manual/sections/enemiesSection';
import { buildItemsSection } from './manual/sections/itemsSection';

/**
 * ManualOverlay — the DOM "How to Play" manual shown over the pause menu.
 *
 * The expanded form of the old options panel: the same in-world frame as the
 * merchant shop (.shop-overlay backdrop + .shop-window grey 9-slice panel) and
 * the same music toggle, fronted by a tab bar (Basics / Controls / Combat / HUD
 * / Enemies / Items). Each tab's section is built once up front; the Combat tab
 * embeds looping sprite-master attack animations (AnimatedSpritePreview), and
 * only the visible tab's previews animate (the rest are paused). The full-
 * viewport backdrop intercepts mouse events so the pause buttons underneath
 * stay unclickable, and while open PauseScene disables its own Phaser keyboard
 * so the two layers never both react to a key — this overlay owns ESC/M plus
 * tab navigation through a window-level capture listener.
 *
 * Inputs:  the parent DOM host, the Phaser scene (for building previews), the
 *          music volume preference, and keyboard/mouse while open.
 * Outputs: the manual DOM tree; live music-volume writes; fires the caller's
 *          onClose when it finishes closing.
 * @calledby the pause menu, when the player opens the manual from the pause UI.
 * @calls    the per-tab section builders, the sprite-preview controllers, and the
 *           shared music-volume audio controls.
 */
interface TabDef {
  readonly id: string;
  readonly label: string;
  readonly build: SectionBuilder;
}

const TABS: ReadonlyArray<TabDef> = [
  { id: 'basics', label: 'Basics', build: buildBasicsSection },
  { id: 'controls', label: 'Controls', build: buildControlsSection },
  { id: 'combat', label: 'Combat', build: buildCombatSection },
  { id: 'hud', label: 'HUD', build: buildHudSection },
  { id: 'enemies', label: 'Enemies', build: buildEnemiesSection },
  { id: 'items', label: 'Items', build: buildItemsSection },
];

interface OpenOptions {
  // Called once the panel closes so PauseScene can re-enable its own keyboard.
  readonly onClose: () => void;
}

interface BuiltTab {
  readonly def: TabDef;
  readonly section: ManualSection;
  readonly button: HTMLButtonElement;
}

export class ManualOverlay extends DomOverlay {
  private readonly scene: Phaser.Scene;

  private contentHostEl: HTMLDivElement | null = null;
  private volumeIconEl: HTMLImageElement | null = null;
  private volumeSliderEl: HTMLInputElement | null = null;

  private builtTabs: BuiltTab[] = [];
  private activeIndex = 0;

  constructor(parent: HTMLElement, scene: Phaser.Scene) {
    super(parent);
    this.scene = scene;
  }

  // Opens the manual; no-op if already open.
  open(options: OpenOptions): void {
    if (this.isOpen()) return;
    this.openShell(options.onClose);
    this.buildDom();
    this.attachKeyboard();
  }

  // Stops all tab sprite-preview rAF loops and clears element refs.
  protected onTeardown(): void {
    for (const tab of this.builtTabs) {
      for (const preview of tab.section.previews) preview.destroy();
    }
    this.builtTabs = [];
    this.contentHostEl = null;
    this.volumeIconEl = null;
    this.volumeSliderEl = null;
    this.activeIndex = 0;
  }

  // Assembles the full window (header, tabs, content, footer), mounts it, and selects the first tab.
  private buildDom(): void {
    const { overlay, win } = this.createBackdrop('shop-window manual-window');

    win.appendChild(this.buildHeader());
    win.appendChild(this.buildTabBar());
    win.appendChild(this.buildContent());
    win.appendChild(this.buildFooter());

    overlay.appendChild(win);
    this.mount(overlay);
    this.syncVolumeUI();
    this.setActiveTab(0);
  }

  // Header row: the "How to Play" title plus the music volume control on the right.
  private buildHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'options-header manual-header';

    const title = document.createElement('h2');
    title.className = 'options-title';
    title.textContent = 'How to Play';
    header.appendChild(title);

    header.appendChild(this.buildVolumeControl());
    return header;
  }

  // Builds the speaker-icon mute button + range slider for music volume; MusicPlayer follows the slider live.
  private buildVolumeControl(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'options-volume';

    const muteButton = document.createElement('button');
    muteButton.type = 'button';
    muteButton.className = 'options-volume-mute';
    const icon = document.createElement('img');
    icon.className = 'options-volume-icon';
    muteButton.appendChild(icon);
    muteButton.addEventListener('click', () => {
      toggleMusicMuted();
      this.syncVolumeUI();
    });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.className = 'options-volume-slider';
    // `input` fires continuously while dragging so volume tracks the bar in real time.
    slider.addEventListener('input', () => {
      setMusicVolume(slider.valueAsNumber / 100);
      this.syncVolumeUI();
    });

    wrap.appendChild(muteButton);
    wrap.appendChild(slider);

    this.volumeIconEl = icon;
    this.volumeSliderEl = slider;
    return wrap;
  }

  // Builds the tab bar and, in the same pass, the section body behind each tab.
  private buildTabBar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'manual-tabs';
    bar.setAttribute('role', 'tablist');

    this.builtTabs = TABS.map((def, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'manual-tab';
      button.textContent = def.label;
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => this.setActiveTab(index));
      bar.appendChild(button);

      const section = def.build(this.scene);
      return { def, section, button };
    });

    return bar;
  }

  // Scrollable content host: stacks every section hidden (setActiveTab reveals one).
  private buildContent(): HTMLDivElement {
    const host = document.createElement('div');
    host.className = 'manual-content';

    for (const tab of this.builtTabs) {
      tab.section.el.style.display = 'none';
      host.appendChild(tab.section.el);
    }

    this.contentHostEl = host;
    return host;
  }

  // Footer row of keyboard hints (Tabs / Mute / Close), each as kbd glyphs + label.
  private buildFooter(): HTMLDivElement {
    const footer = document.createElement('div');
    footer.className = 'options-footer manual-footer';

    const hints: ReadonlyArray<{ keys: ReadonlyArray<string>; label: string }> =
      [
        { keys: ['←', '→'], label: 'Tabs' },
        { keys: ['M'], label: 'Mute' },
        { keys: ['Esc'], label: 'Close' },
      ];

    for (const hint of hints) {
      const span = document.createElement('div');
      span.className = 'options-footer-hint';
      for (const key of hint.keys) {
        const kbd = document.createElement('kbd');
        kbd.className = 'options-key';
        kbd.textContent = key;
        span.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.textContent = hint.label;
      span.appendChild(label);
      footer.appendChild(span);
    }

    return footer;
  }

  // Switches to the given tab: stops the previous tab's previews, starts the new one's, resets scroll.
  private setActiveTab(index: number): void {
    if (index < 0 || index >= this.builtTabs.length) return;
    const previous = this.builtTabs[this.activeIndex];
    if (previous && this.overlayEl && index !== this.activeIndex) {
      previous.section.el.style.display = 'none';
      previous.button.classList.remove('manual-tab--active');
      for (const preview of previous.section.previews) preview.stop();
    }

    const next = this.builtTabs[index];
    next.section.el.style.display = '';
    next.button.classList.add('manual-tab--active');
    for (const preview of next.section.previews) preview.start();
    if (this.contentHostEl) this.contentHostEl.scrollTop = 0;

    this.activeIndex = index;
  }

  // Steps the active tab by delta with wrap-around (delta +1 / -1 from arrow keys).
  private cycleTab(delta: number): void {
    const count = this.builtTabs.length;
    this.setActiveTab((this.activeIndex + delta + count) % count);
  }

  // Syncs slider value, speaker icon, filled track, and a11y labels to the current music volume.
  private syncVolumeUI(): void {
    if (!this.volumeIconEl || !this.volumeSliderEl) return;
    const volume = getMusicVolume();
    const muted = volume <= 0;
    const pct = Math.round(volume * 100);
    if (this.volumeSliderEl.valueAsNumber !== pct) { // avoid clobbering a value the user is actively dragging
      this.volumeSliderEl.value = String(pct);
    }
    this.volumeIconEl.src = muted
      ? OPTIONS_SOUND_OFF_ICON_PATH
      : OPTIONS_SOUND_ON_ICON_PATH;
    const label = muted ? 'Music muted' : `Music volume ${pct}%`;
    this.volumeIconEl.alt = label;
    this.volumeSliderEl.setAttribute('aria-label', label);
    this.volumeSliderEl.setAttribute('aria-valuetext', muted ? 'Muted' : `${pct}%`);
    this.volumeSliderEl.classList.toggle('options-volume-slider--muted', muted);
    this.volumeSliderEl.style.setProperty('--volume-fill', `${pct}%`); // drives the filled track portion (see options.css)
  }

  // ESC closes, M mutes, ←/→ cycle tabs, digit 1–N jumps to that tab; slider focus gets all keys except ESC.
  protected onKeydown(e: KeyboardEvent): void {
    // Let the slider handle its own arrow/digit keys while focused, except ESC.
    if (e.target === this.volumeSliderEl && e.key !== 'Escape') {
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.close();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        e.stopPropagation();
        toggleMusicMuted();
        this.syncVolumeUI();
        break;
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        this.cycleTab(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        this.cycleTab(-1);
        break;
      default: {
        const digit = Number.parseInt(e.key, 10);
        if (!Number.isNaN(digit) && digit >= 1 && digit <= TABS.length) {
          e.preventDefault();
          e.stopPropagation();
          this.setActiveTab(digit - 1);
        }
        break;
      }
    }
  }
}
