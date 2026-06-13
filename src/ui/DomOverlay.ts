/**
 * DomOverlay — abstract base for the DOM panels rendered over the Phaser canvas.
 *
 * Shared scaffolding for the styled HTML overlays (merchant shop, How-to-Play
 * manual, credits). Each lives in the same #game parent as the canvas: a
 * full-viewport dim backdrop (.shop-overlay) that closes on outside-click, a
 * framed window, and a window-level capture-phase keydown listener the overlay
 * owns while open. The base owns the open/close lifecycle; subclasses own
 * everything visible — they build the window contents, decide their keydown
 * behavior (the handlers genuinely differ: the shop navigates items, the manual
 * cycles tabs and toggles mute, credits only closes), and reset their extra
 * state in onTeardown().
 *
 * Inputs:  the #game parent element; keyboard events while open.
 * Outputs: appends/removes overlay DOM, owns a window keydown listener, and
 *          fires the onClose callback back to the launching scene.
 * @calledby the scenes that open a shop/manual/credits panel and need the
 *           game paused behind a modal overlay.
 * @calls    the DOM (element create/append/remove, event listeners) and the
 *           subclass hooks that build contents and handle keys.
 */
export abstract class DomOverlay {
  protected readonly parent: HTMLElement;

  protected overlayEl: HTMLDivElement | null = null;
  private onCloseCb: (() => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  protected constructor(parent: HTMLElement) {
    this.parent = parent;
  }

  // True while the overlay DOM is mounted.
  isOpen(): boolean {
    return this.overlayEl !== null;
  }

  // Tears down the panel and fires onClose so the launching scene can resume.
  close(): void {
    if (!this.isOpen()) return;
    const cb = this.onCloseCb;
    this.teardown();
    if (cb) cb();
  }

  // Force-close without firing onClose — used when the launching scene is itself shutting down.
  destroy(): void {
    if (!this.isOpen()) return;
    this.teardown();
  }

  // Arms the close callback; subclass open() calls this first, then builds DOM and attaches keyboard.
  protected openShell(onClose: () => void): void {
    this.onCloseCb = onClose;
  }

  // Creates the dim backdrop (closes on outside-click) and an empty framed window for the subclass to fill.
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

  // Appends the built overlay to the #game parent and records it as open.
  protected mount(overlay: HTMLDivElement): void {
    this.parent.appendChild(overlay);
    this.overlayEl = overlay;
  }

  // Window-level capture-phase key handler; subclass decides which keys it handles.
  protected abstract onKeydown(e: KeyboardEvent): void;

  // Hook for subclass teardown before the shell DOM is removed (release previews, refs, etc.).
  protected onTeardown(): void {}

  // Arms the window-level capture-phase keydown listener for this panel.
  protected attachKeyboard(): void {
    const handler = (e: KeyboardEvent): void => this.onKeydown(e);
    window.addEventListener('keydown', handler, true);
    this.keydownHandler = handler;
  }

  // Removes the keydown listener if one is armed.
  private detachKeyboard(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }

  // Releases keyboard listener, runs the subclass hook, removes the DOM, clears the callback.
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
