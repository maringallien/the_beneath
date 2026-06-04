import {
  OPTIONS_SOUND_OFF_ICON_PATH,
  OPTIONS_SOUND_ON_ICON_PATH,
} from '../constants';
import { isMusicEnabled, toggleMusicEnabled } from '../audio';
import './shop.css';
import './options.css';

// One row in the controls list: the key(s) that trigger an action and a short
// label. `keys` renders as one chip per entry.
interface CommandRow {
  readonly keys: ReadonlyArray<string>;
  readonly label: string;
}

// A titled group of related controls. Kept here next to the overlay because it
// is pure presentation — the authoritative bindings live in Player /
// InteractionManager; this is the player-facing cheat sheet that mirrors them
// (debug-only keys like fly mode are intentionally omitted).
interface CommandCategory {
  readonly title: string;
  readonly commands: ReadonlyArray<CommandRow>;
}

const CATEGORIES: ReadonlyArray<CommandCategory> = [
  {
    title: 'Movement',
    commands: [
      { keys: ['A', 'D'], label: 'Move' },
      { keys: ['W'], label: 'Jump' },
      { keys: ['S'], label: 'Roll' },
      { keys: ['Shift'], label: 'Dash' },
    ],
  },
  {
    title: 'Actions',
    commands: [
      { keys: ['E'], label: 'Interact (hold)' },
      { keys: ['F'], label: 'Magic stance' },
      { keys: ['Q'], label: 'Use heal item' },
    ],
  },
  {
    title: 'Mouse',
    commands: [
      { keys: ['L-Click'], label: 'Attack / Fire' },
      { keys: ['R-Click'], label: 'Block' },
      { keys: ['Wheel'], label: 'Switch weapon' },
    ],
  },
];

interface OpenOptions {
  // Invoked once the overlay finishes closing (ESC, backdrop click, or
  // programmatic close). PauseScene uses this to re-enable its own keyboard
  // navigation, which it disables while the panel is up.
  readonly onClose: () => void;
}

// DOM-based options panel shown over the pause menu. Mirrors the architecture
// of ShopOverlay (styled HTML over the Phaser canvas inside the same #game
// parent) and reuses the merchant shop's frame (the .shop-overlay backdrop +
// .shop-window grey 9-slice panel) so it matches the merchants' bounding box.
// The inner content (header, three control categories, footer) is sized by
// options.css. Lists the game's controls and exposes a music on/off toggle.
//
// Input note: while this overlay is open, PauseScene disables its Phaser
// keyboard so the two input layers never both react to the same key. The
// overlay owns its keys via a window-level capture listener (same approach as
// ShopOverlay), and the full-viewport backdrop intercepts mouse events so the
// pause buttons underneath can't be clicked through it.
export class OptionsOverlay {
  private readonly parent: HTMLElement;

  private overlayEl: HTMLDivElement | null = null;
  private soundButtonEl: HTMLButtonElement | null = null;
  private soundIconEl: HTMLImageElement | null = null;
  private onClose: (() => void) | null = null;

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
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

  // User-facing close (ESC, backdrop click). Tears down the DOM/listeners and
  // invokes onClose so PauseScene re-enables its keyboard navigation.
  close(): void {
    if (!this.isOpen()) return;
    const cb = this.onClose;
    this.teardown();
    if (cb) cb();
  }

  // Force-close path: drops the DOM and listeners WITHOUT invoking onClose.
  // Used when PauseScene shuts down (e.g. the player quits to the home menu)
  // while the panel happens to be open — there is no menu left to hand back to.
  destroy(): void {
    if (!this.isOpen()) return;
    this.teardown();
  }

  private teardown(): void {
    this.detachKeyboard();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.soundButtonEl = null;
    this.soundIconEl = null;
    this.onClose = null;
  }

  private buildDom(): void {
    const overlay = document.createElement('div');
    overlay.className = 'shop-overlay';

    // Clicking the dim backdrop (outside the window) closes the panel — the
    // same "click outside to dismiss" idiom as the merchant shop.
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    const win = document.createElement('div');
    win.className = 'shop-window options-window';

    win.appendChild(this.buildHeader());
    win.appendChild(this.buildCategories());
    win.appendChild(this.buildFooter());

    overlay.appendChild(win);
    this.parent.appendChild(overlay);

    this.overlayEl = overlay;
    this.syncSoundToggle();
  }

  private buildHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'options-header';

    const title = document.createElement('h2');
    title.className = 'options-title';
    title.textContent = 'Options';
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

  private buildCategories(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'options-categories';

    for (const category of CATEGORIES) {
      const block = document.createElement('div');
      block.className = 'options-category';

      const title = document.createElement('h3');
      title.className = 'options-category-title';
      title.textContent = category.title;
      block.appendChild(title);

      for (const command of category.commands) {
        block.appendChild(this.buildCommandRow(command));
      }

      container.appendChild(block);
    }

    return container;
  }

  private buildCommandRow(command: CommandRow): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'options-command';

    const keys = document.createElement('span');
    keys.className = 'options-command-keys';
    for (const key of command.keys) {
      const kbd = document.createElement('kbd');
      kbd.className = 'options-key';
      kbd.textContent = key;
      keys.appendChild(kbd);
    }
    row.appendChild(keys);

    const label = document.createElement('span');
    label.className = 'options-command-label';
    label.textContent = command.label;
    row.appendChild(label);

    return row;
  }

  private buildFooter(): HTMLDivElement {
    const footer = document.createElement('div');
    footer.className = 'options-footer';

    const hints: ReadonlyArray<{ key: string; label: string }> = [
      { key: 'M', label: 'Music' },
      { key: 'Esc', label: 'Close' },
    ];

    for (const hint of hints) {
      const span = document.createElement('div');
      span.className = 'options-footer-hint';
      const kbd = document.createElement('kbd');
      kbd.className = 'options-key';
      kbd.textContent = hint.key;
      span.appendChild(kbd);
      const label = document.createElement('span');
      label.textContent = hint.label;
      span.appendChild(label);
      footer.appendChild(span);
    }

    return footer;
  }

  // Reflects the current music preference onto the toggle: the speaker icon
  // when on, the muted-speaker icon (plus a dimmed button) when off.
  private syncSoundToggle(): void {
    if (!this.soundButtonEl || !this.soundIconEl) return;
    const on = isMusicEnabled();
    this.soundIconEl.src = on
      ? OPTIONS_SOUND_ON_ICON_PATH
      : OPTIONS_SOUND_OFF_ICON_PATH;
    const stateLabel = on ? 'Music on' : 'Music off';
    this.soundIconEl.alt = stateLabel;
    this.soundButtonEl.setAttribute('aria-label', `${stateLabel} (click to toggle)`);
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
        default:
          break;
      }
    };
    // Capture phase + window-level so the key is caught regardless of focus,
    // and stopPropagation keeps it from also reaching Phaser. PauseScene
    // additionally disables its own keyboard while the panel is open, so this
    // is the only active key handler.
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
