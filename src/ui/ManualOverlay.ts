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
 * @file ui/ManualOverlay.ts
 * @description DOM "How to Play" manual over the pause menu — the merchant-shop frame plus a music toggle, fronted by a tab bar (Basics/Controls/Combat/HUD/Enemies/Items); each section is built once up front and only the visible tab's sprite previews animate; owns ESC/M plus tab navigation through a window-level capture listener.
 * @module ui
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

  /**
   * @function    open
   * @description Open the manual; no-op if already open.
   * @param   options  Carries the onClose callback fired when the manual closes.
   * @calledby src/scenes/PauseScene.ts and src/scenes/LandingScene.ts → their How-to-Play handlers
   * @calls    src/ui/DomOverlay.ts → openShell, src/ui/ManualOverlay.ts → buildDom, and src/ui/DomOverlay.ts → attachKeyboard
   */
  open(options: OpenOptions): void {
    if (this.isOpen()) return;
    this.openShell(options.onClose);
    this.buildDom();
    this.attachKeyboard();
  }

  /**
   * @function    onTeardown
   * @description Destroy every tab's sprite-preview rAF loops and reset the overlay's element/state refs.
   * @calledby src/ui/DomOverlay.ts → teardown, while closing the manual
   * @calls    each preview's destroy
   */
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

  /**
   * @function    buildDom
   * @description Assemble and mount the full window (header, tabs, content, footer), sync the volume UI, and activate the first tab.
   * @calledby src/ui/ManualOverlay.ts → open
   * @calls    src/ui/ManualOverlay.ts → buildHeader/buildTabBar/buildContent/buildFooter/syncVolumeUI/setActiveTab, plus src/ui/DomOverlay.ts → createBackdrop/mount
   */
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

  /**
   * @function    buildHeader
   * @description Build the header row — the "How to Play" title plus the music volume control on the right.
   * @returns a detached header div.
   * @calledby src/ui/ManualOverlay.ts → buildDom
   * @calls    src/ui/ManualOverlay.ts → buildVolumeControl and DOM element creation
   */
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

  /**
   * @function    buildVolumeControl
   * @description Build the speaker-icon mute button + range slider for music volume (MusicPlayer follows the slider live), recording the icon/slider refs for later syncing.
   * @returns a detached volume-control div.
   * @calledby src/ui/ManualOverlay.ts → buildHeader
   * @calls    src/audio → toggleMusicMuted / setMusicVolume (on click/drag) and src/ui/ManualOverlay.ts → syncVolumeUI
   */
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

  /**
   * @function    buildTabBar
   * @description Build the tab bar and, in the same pass, the section body behind each tab, populating builtTabs with each tab's button + built section.
   * @returns a detached tab-bar div.
   * @calledby src/ui/ManualOverlay.ts → buildDom
   * @calls    each tab's section builder (a tab-button click activates that tab via setActiveTab) and DOM creation
   */
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

  /**
   * @function    buildContent
   * @description Build the scrollable content host, appending every (already-built) section hidden so the active-tab switch reveals one; records the host ref.
   * @returns a detached scrollable host.
   * @calledby src/ui/ManualOverlay.ts → buildDom, after the tab bar is built
   * @calls    DOM append only
   */
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

  /**
   * @function    buildFooter
   * @description Build the footer row of keyboard hints (Tabs / Mute / Close), each as kbd glyphs + label.
   * @returns a detached footer div of hint chips.
   * @calledby src/ui/ManualOverlay.ts → buildDom
   * @calls    DOM element-create/append only
   */
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

  /**
   * @function    setActiveTab
   * @description Switch to the given tab — reveal the chosen section, hide the previous, swap preview rAF loops, and reset scroll. Out-of-range index is ignored.
   * @param   index  Target tab index.
   * @calledby src/ui/ManualOverlay.ts → buildDom, cycleTab, onKeydown, and tab-button click handlers
   * @calls    each tab's preview start/stop controls
   */
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

  /**
   * @function    cycleTab
   * @description Step the active tab by delta with wrap-around at the ends.
   * @param   delta  +1 to advance, -1 to go back.
   * @calledby src/ui/ManualOverlay.ts → onKeydown, on the left/right arrow keypresses
   * @calls    src/ui/ManualOverlay.ts → setActiveTab
   */
  private cycleTab(delta: number): void {
    const count = this.builtTabs.length;
    this.setActiveTab((this.activeIndex + delta + count) % count);
  }

  /**
   * @function    syncVolumeUI
   * @description Sync slider value, speaker icon, filled track, and a11y labels to the live music volume; avoids clobbering a value being dragged. No-op if refs missing.
   * @calledby src/ui/ManualOverlay.ts → buildDom, buildVolumeControl, and onKeydown, after any mute/volume change
   * @calls    src/audio → getMusicVolume and DOM attribute writes
   */
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

  /**
   * @function    onKeydown
   * @description Dispatch ESC (close), M (mute), left/right (cycle tabs), and digit 1-N (jump to that tab), swallowing handled keys; a focused slider keeps all its own keys except ESC.
   * @param   e  Keyboard event from the window-level capture listener.
   * @calledby src/ui/DomOverlay.ts → the capture-phase keydown listener, on any keypress while open
   * @calls    src/ui/DomOverlay.ts → close, src/audio → toggleMusicMuted, and src/ui/ManualOverlay.ts → syncVolumeUI/cycleTab/setActiveTab
   */
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
