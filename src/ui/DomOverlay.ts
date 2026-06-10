// Shared scaffolding for the DOM panels rendered over the Phaser canvas
// (merchant shop, How-to-Play manual, credits). Each is a styled HTML overlay
// inside the same #game parent: a full-viewport dim backdrop (.shop-overlay)
// that closes on outside-click, a framed window, and a window-level
// capture-phase keydown listener owned by the overlay while it is open.
//
// The base owns the open/close lifecycle; subclasses own everything visible:
// they build their window contents, decide their keydown behavior (the
// handlers genuinely differ — the shop navigates items, the manual cycles
// tabs and toggles mute, credits only closes), and reset their extra state
// in onTeardown().
export abstract class DomOverlay {
  protected readonly parent: HTMLElement;

  protected overlayEl: HTMLDivElement | null = null;
  private onCloseCb: (() => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  protected constructor(parent: HTMLElement) {
    this.parent = parent;
  }

  isOpen(): boolean {
    return this.overlayEl !== null;
  }

  // User-facing close (ESC, backdrop click, or programmatic). Tears down the
  // DOM/listeners and invokes the onClose callback handed to openShell — the
  // launching scene uses it to resume itself / re-enable its keyboard.
  close(): void {
    if (!this.isOpen()) return;
    const cb = this.onCloseCb;
    this.teardown();
    if (cb) cb();
  }

  // Force-close path: drops the DOM and listeners WITHOUT invoking onClose.
  // Used when the launching scene is itself shutting down (HMR rebuild,
  // Start committed) — there is nothing left to hand control back to.
  destroy(): void {
    if (!this.isOpen()) return;
    this.teardown();
  }

  // Subclass open() calls this first to arm the close callback, then builds
  // its DOM and calls attachKeyboard().
  protected openShell(onClose: () => void): void {
    this.onCloseCb = onClose;
  }

  // Builds the shared shell: the dim full-viewport backdrop that closes the
  // panel when the click lands outside the window, plus the framed window
  // element. The subclass fills `win`, appends it to `overlay`, and mounts.
  protected createBackdrop(windowClassName: string): {
    overlay: HTMLDivElement;
    win: HTMLDivElement;
  } {
    const overlay = document.createElement('div');
    overlay.className = 'shop-overlay';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });
    const win = document.createElement('div');
    win.className = windowClassName;
    return { overlay, win };
  }

  protected mount(overlay: HTMLDivElement): void {
    this.parent.appendChild(overlay);
    this.overlayEl = overlay;
  }

  // Per-overlay key handling, attached while open. Capture phase + window
  // level so keys are caught regardless of focus; the launching scene
  // disables its own Phaser keyboard while the panel is up, so this is the
  // only active handler.
  protected abstract onKeydown(e: KeyboardEvent): void;

  // Hook for subclass-owned teardown: runs before the shell DOM is removed,
  // so previews and element references are released in the same order the
  // overlays used before sharing this base.
  protected onTeardown(): void {}

  protected attachKeyboard(): void {
    const handler = (e: KeyboardEvent): void => this.onKeydown(e);
    window.addEventListener('keydown', handler, true);
    this.keydownHandler = handler;
  }

  private detachKeyboard(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }

  private teardown(): void {
    this.detachKeyboard();
    this.onTeardown();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.onCloseCb = null;
  }
}
