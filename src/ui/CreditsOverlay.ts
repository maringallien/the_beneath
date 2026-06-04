import { CREDITS_TITLE_TEXT } from '../constants';
import './shop.css';
import './credits.css';

// One credit line: a small label (e.g. "Art"), the credited party, and an
// optional detail line beneath (e.g. the asset pack the credit is for).
interface CreditEntry {
  readonly label: string;
  readonly name: string;
  readonly detail?: string;
}

// The credit lines, in display order. Kept here next to the overlay because it
// is pure presentation (same rationale as OptionsOverlay's CATEGORIES). The
// game title is the one piece pulled from constants since it mirrors the
// landing-page title.
const CREDIT_ENTRIES: ReadonlyArray<CreditEntry> = [
  { label: 'Created by', name: 'Marin Gallien' },
  {
    label: 'Art',
    name: 'Penusbmic',
    detail: 'The Dark Series — sprites and tilesets',
  },
];

interface OpenCredits {
  // Invoked once the overlay finishes closing (ESC, backdrop click, or
  // programmatic close). LandingScene uses this to re-enable its own keyboard
  // (Enter/Space → Start), which it disables while the panel is up.
  readonly onClose: () => void;
}

// DOM-based credits panel shown over the home screen, opened from the landing
// page's CREDITS button. Mirrors OptionsOverlay's architecture (styled HTML over
// the Phaser canvas inside the same #game parent) and reuses the merchant shop's
// frame (the .shop-overlay backdrop + .shop-window grey panel) so it reads as the
// same piece of in-world UI. Content is intentionally minimal — the game title
// and a single author line (see credits.css for layout).
//
// Input note: while this overlay is open, LandingScene disables its Phaser
// keyboard so its Enter/Space → Start binding can't fire underneath. The overlay
// owns ESC via a window-level capture listener (same approach as OptionsOverlay),
// and the full-viewport backdrop intercepts mouse events so the menu buttons
// underneath can't be clicked through it.
export class CreditsOverlay {
  private readonly parent: HTMLElement;

  private overlayEl: HTMLDivElement | null = null;
  private onClose: (() => void) | null = null;

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
  }

  isOpen(): boolean {
    return this.overlayEl !== null;
  }

  open(options: OpenCredits): void {
    if (this.isOpen()) return;
    this.onClose = options.onClose;
    this.buildDom();
    this.attachKeyboard();
  }

  // User-facing close (ESC, backdrop click). Tears down the DOM/listeners and
  // invokes onClose so LandingScene re-enables its keyboard.
  close(): void {
    if (!this.isOpen()) return;
    const cb = this.onClose;
    this.teardown();
    if (cb) cb();
  }

  // Force-close path: drops the DOM and listeners WITHOUT invoking onClose. Used
  // when LandingScene shuts down (e.g. Start is committed) while the panel
  // happens to be open — there is no menu left to hand back to.
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
    this.onClose = null;
  }

  private buildDom(): void {
    const overlay = document.createElement('div');
    overlay.className = 'shop-overlay';

    // Clicking the dim backdrop (outside the window) closes the panel — the
    // same "click outside to dismiss" idiom as the merchant shop and options.
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    const win = document.createElement('div');
    win.className = 'shop-window credits-window';

    const title = document.createElement('h2');
    title.className = 'credits-title';
    title.textContent = CREDITS_TITLE_TEXT;
    win.appendChild(title);

    const body = document.createElement('div');
    body.className = 'credits-body';
    for (const entry of CREDIT_ENTRIES) {
      body.appendChild(this.buildEntry(entry));
    }
    win.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'credits-footer';
    const kbd = document.createElement('kbd');
    kbd.className = 'credits-key';
    kbd.textContent = 'Esc';
    footer.appendChild(kbd);
    const hint = document.createElement('span');
    hint.textContent = 'Close';
    footer.appendChild(hint);
    win.appendChild(footer);

    overlay.appendChild(win);
    this.parent.appendChild(overlay);

    this.overlayEl = overlay;
  }

  // Renders one credit line: label (small, dimmed), credited name, and an
  // optional detail line beneath it.
  private buildEntry(entry: CreditEntry): HTMLDivElement {
    const block = document.createElement('div');
    block.className = 'credits-entry';

    const label = document.createElement('div');
    label.className = 'credits-label';
    label.textContent = entry.label;
    block.appendChild(label);

    const name = document.createElement('div');
    name.className = 'credits-name';
    name.textContent = entry.name;
    block.appendChild(name);

    if (entry.detail) {
      const detail = document.createElement('div');
      detail.className = 'credits-detail';
      detail.textContent = entry.detail;
      block.appendChild(detail);
    }

    return block;
  }

  private attachKeyboard(): void {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    // Capture phase + window-level so the key is caught regardless of focus, and
    // stopPropagation keeps it from also reaching Phaser. LandingScene
    // additionally disables its own keyboard while the panel is open, so this is
    // the only active key handler.
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
