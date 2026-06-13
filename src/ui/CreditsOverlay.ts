import { CREDITS_TITLE_TEXT } from '../constants';
import { DomOverlay } from './DomOverlay';
import './shop.css';
import './credits.css';

// One credit entry: a small label (e.g. "Art"), the credited party, and an optional detail line.
interface CreditEntry {
  readonly label: string;
  readonly name: string;
  readonly detail?: string;
}

// Credit lines in display order; pure presentation, kept co-located with the overlay.
const CREDIT_ENTRIES: ReadonlyArray<CreditEntry> = [
  { label: 'Created by', name: 'Marin Gallien' },
  {
    label: 'Art',
    name: 'Penusbmic',
    detail: 'The Dark Series — sprites and tilesets',
  },
];

interface OpenCredits {
  // Called once the panel closes so LandingScene can re-enable its own keyboard.
  readonly onClose: () => void;
}

/**
 * CreditsOverlay — DOM credits panel shown over the home screen.
 *
 * Opened from the landing page's CREDITS button. Mirrors OptionsOverlay's
 * architecture (styled HTML over the Phaser canvas inside the same #game parent)
 * and reuses the merchant shop's frame (the .shop-overlay backdrop + .shop-window
 * grey panel) so it reads as the same in-world UI. Content is intentionally
 * minimal — the game title plus a single author line (layout in credits.css).
 * While open it owns ESC via a window-level capture listener and its full-viewport
 * backdrop intercepts mouse events, so the menu buttons underneath can't fire (the
 * landing scene also disables its own Phaser keyboard for the duration).
 *
 * Inputs:  the #game parent element; the caller's onClose callback; CREDIT_ENTRIES.
 * Outputs: an appended DOM subtree (backdrop + window) and an ESC key listener.
 * @calledby the landing screen, when the player opens the credits panel.
 * @calls    the shared DOM-overlay shell (backdrop/mount/keyboard) and the DOM API.
 */
export class CreditsOverlay extends DomOverlay {
  constructor(parent: HTMLElement) {
    super(parent);
  }

  // Opens the panel; no-op if already open so a double-click can't stack two.
  open(options: OpenCredits): void {
    if (this.isOpen()) return;
    this.openShell(options.onClose);
    this.buildDom();
    this.attachKeyboard();
  }

  // Builds the shop-framed window (title, credit entries, ESC footer) and mounts it.
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

  // Closes on ESC; other keys fall through untouched.
  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }
}
