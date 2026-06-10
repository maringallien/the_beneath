import { CREDITS_TITLE_TEXT } from '../constants';
import { DomOverlay } from './DomOverlay';
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
export class CreditsOverlay extends DomOverlay {
  constructor(parent: HTMLElement) {
    super(parent);
  }

  open(options: OpenCredits): void {
    if (this.isOpen()) return;
    this.openShell(options.onClose);
    this.buildDom();
    this.attachKeyboard();
  }

  private buildDom(): void {
    const { overlay, win } = this.createBackdrop('shop-window credits-window');

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
    this.mount(overlay);
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

  // ESC closes; stopPropagation keeps it from also reaching Phaser.
  // LandingScene additionally disables its own keyboard while the panel is
  // open, so this is the only active key handler.
  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }
}
