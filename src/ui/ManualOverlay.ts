import type Phaser from 'phaser';
import {
  OPTIONS_SOUND_OFF_ICON_PATH,
  OPTIONS_SOUND_ON_ICON_PATH,
} from '../constants';
import { isMusicEnabled, toggleMusicEnabled } from '../audio';
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
  // Invoked once the overlay finishes closing (ESC, backdrop click, or
  // programmatic close). PauseScene uses this to re-enable its own keyboard.
  readonly onClose: () => void;
}

interface BuiltTab {
  readonly def: TabDef;
  readonly section: ManualSection;
  readonly button: HTMLButtonElement;
}

// DOM-based "How to Play" manual shown over the pause menu — the expanded form of
// the old options panel. Same in-world frame as the merchant shop (.shop-overlay
// backdrop + .shop-window grey 9-slice panel) and the same music toggle, now with
// a tab bar: Basics / Controls / Combat / HUD / Enemies / Items. The Combat tab
// embeds looping sprite-master attack animations (AnimatedSpritePreview); only
// the visible tab's previews animate.
//
// Input: while open, PauseScene disables its Phaser keyboard so the two layers
// never both react to a key. This overlay owns its keys via a window-level
// capture listener (ESC/M plus tab navigation), and the full-viewport backdrop
// intercepts mouse events so the pause buttons underneath can't be clicked.
export class ManualOverlay {
  private readonly parent: HTMLElement;
  private readonly scene: Phaser.Scene;

  private overlayEl: HTMLDivElement | null = null;
  private contentHostEl: HTMLDivElement | null = null;
  private soundButtonEl: HTMLButtonElement | null = null;
  private soundIconEl: HTMLImageElement | null = null;
  private onClose: (() => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  private builtTabs: BuiltTab[] = [];
  private activeIndex = 0;

  constructor(parent: HTMLElement, scene: Phaser.Scene) {
    this.parent = parent;
    this.scene = scene;
  }

  isOpen(): boolean {
    return this.overlayEl !== null;
  }

  open(options: OpenOptions): void {
    if (this.isOpen()) return;
    this.onClose = options.onClose;
    this.buildDom();
    this.attachKeyboard();
  }

  // User-facing close (ESC, backdrop click). Tears down and invokes onClose.
  close(): void {
    if (!this.isOpen()) return;
    const cb = this.onClose;
    this.teardown();
    if (cb) cb();
  }

  // Force-close path: drops DOM + listeners WITHOUT invoking onClose. Used when
  // PauseScene shuts down while the panel happens to be open.
  destroy(): void {
    if (!this.isOpen()) return;
    this.teardown();
  }

  private teardown(): void {
    this.detachKeyboard();
    for (const tab of this.builtTabs) {
      for (const preview of tab.section.previews) preview.destroy();
    }
    this.builtTabs = [];
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.contentHostEl = null;
    this.soundButtonEl = null;
    this.soundIconEl = null;
    this.onClose = null;
    this.activeIndex = 0;
  }

  private buildDom(): void {
    const overlay = document.createElement('div');
    overlay.className = 'shop-overlay';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    const win = document.createElement('div');
    win.className = 'shop-window manual-window';

    win.appendChild(this.buildHeader());
    win.appendChild(this.buildTabBar());
    win.appendChild(this.buildContent());
    win.appendChild(this.buildFooter());

    overlay.appendChild(win);
    this.parent.appendChild(overlay);

    this.overlayEl = overlay;
    this.syncSoundToggle();
    this.setActiveTab(0);
  }

  private buildHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'options-header manual-header';

    const title = document.createElement('h2');
    title.className = 'options-title';
    title.textContent = 'How to Play';
    header.appendChild(title);

    header.appendChild(this.buildSoundToggle());
    return header;
  }

  private buildSoundToggle(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'options-sound-toggle';

    const icon = document.createElement('img');
    icon.className = 'options-sound-icon';
    button.appendChild(icon);

    button.addEventListener('click', () => {
      toggleMusicEnabled();
      this.syncSoundToggle();
    });

    this.soundButtonEl = button;
    this.soundIconEl = icon;
    return button;
  }

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

  private buildFooter(): HTMLDivElement {
    const footer = document.createElement('div');
    footer.className = 'options-footer manual-footer';

    const hints: ReadonlyArray<{ keys: ReadonlyArray<string>; label: string }> =
      [
        { keys: ['←', '→'], label: 'Tabs' },
        { keys: ['M'], label: 'Music' },
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

  // Switches the visible tab: hides + pauses the previous section's previews and
  // shows + starts the new one's, so only the active tab animates.
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

  private cycleTab(delta: number): void {
    const count = this.builtTabs.length;
    this.setActiveTab((this.activeIndex + delta + count) % count);
  }

  private syncSoundToggle(): void {
    if (!this.soundButtonEl || !this.soundIconEl) return;
    const on = isMusicEnabled();
    this.soundIconEl.src = on
      ? OPTIONS_SOUND_ON_ICON_PATH
      : OPTIONS_SOUND_OFF_ICON_PATH;
    const stateLabel = on ? 'Music on' : 'Music off';
    this.soundIconEl.alt = stateLabel;
    this.soundButtonEl.setAttribute(
      'aria-label',
      `${stateLabel} (click to toggle)`,
    );
    this.soundButtonEl.setAttribute('aria-pressed', String(on));
    this.soundButtonEl.classList.toggle('options-sound-toggle--muted', !on);
  }

  private attachKeyboard(): void {
    const handler = (e: KeyboardEvent): void => {
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
          toggleMusicEnabled();
          this.syncSoundToggle();
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
          // Number keys 1..N jump straight to a tab.
          const digit = Number.parseInt(e.key, 10);
          if (!Number.isNaN(digit) && digit >= 1 && digit <= TABS.length) {
            e.preventDefault();
            e.stopPropagation();
            this.setActiveTab(digit - 1);
          }
          break;
        }
      }
    };
    // Capture phase + window-level so the key is caught regardless of focus, and
    // stopPropagation keeps it from also reaching Phaser. PauseScene disables its
    // own keyboard while open, so this is the only active handler.
    window.addEventListener('keydown', handler, true);
    this.keydownHandler = handler;
  }

  private detachKeyboard(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }
}
