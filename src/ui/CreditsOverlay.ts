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
 * @file ui/CreditsOverlay.ts
 * @description DOM credits panel over the home screen (opened from the landing CREDITS button) reusing the merchant shop's frame so it reads as the same in-world UI; owns ESC via a window-level capture listener and its full-viewport backdrop blocks the menu buttons underneath.
 * @module ui
 */
export class CreditsOverlay extends DomOverlay {
  constructor(parent: HTMLElement) {
    super(parent);
  }

  /**
   * @function    open
   * @description Open the panel; no-op if already open so a double-click can't stack two.
   * @param   options  Carries the onClose callback fired when the panel closes.
   * @calledby src/scenes/LandingScene.ts → the CREDITS button handler
   * @calls    src/ui/DomOverlay.ts → openShell, src/ui/CreditsOverlay.ts → buildDom, and src/ui/DomOverlay.ts → attachKeyboard
   */
  open(options: OpenCredits): void {
    if (this.isOpen()) return;
    this.openShell(options.onClose);
    this.buildDom();
    this.attachKeyboard();
  }

  /**
   * @function    buildDom
   * @description Build the shop-framed window (title, credit entries, ESC footer) from the static CREDIT_ENTRIES list and mount it.
   * @calledby src/ui/CreditsOverlay.ts → open
   * @calls    src/ui/DomOverlay.ts → createBackdrop, src/ui/CreditsOverlay.ts → buildEntry, and src/ui/DomOverlay.ts → mount
   */
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

  /**
   * @function    buildEntry
   * @description Render one credit line: label (small, dimmed), credited name, and an optional detail line beneath it.
   * @param   entry  Label, name, and optional detail.
   * @returns a detached credit-entry div.
   * @calledby src/ui/CreditsOverlay.ts → buildDom, once per entry
   * @calls    the DOM element-create/append API only
   */
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

  /**
   * @function    onKeydown
   * @description Close on ESC (swallowing the event); other keys fall through untouched.
   * @param   e  Keyboard event from the window-level capture listener.
   * @calledby src/ui/DomOverlay.ts → the capture-phase keydown listener, on any keypress while open
   * @calls    src/ui/DomOverlay.ts → close
   */
  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }
}
