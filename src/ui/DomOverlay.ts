/**
 * @file ui/DomOverlay.ts
 * @description Abstract base for DOM panels over the Phaser canvas (shop, manual, credits) — owns the open/close lifecycle: a dim outside-click backdrop, a framed window, and a window-level capture keydown listener; subclasses build the contents and decide their keydown behaviour.
 * @module ui
 */
export abstract class DomOverlay {
  protected readonly parent: HTMLElement;

  protected overlayEl: HTMLDivElement | null = null;
  private onCloseCb: (() => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  protected constructor(parent: HTMLElement) {
    this.parent = parent;
  }

  /** True while the overlay DOM is mounted. */
  isOpen(): boolean {
    return this.overlayEl !== null;
  }

  /**
   * @function    close
   * @description Tear down the panel and fire onClose so the launching scene can resume; no-op if already closed.
   * @calledby a subclass when the user dismisses the panel (ESC, outside-click, or a buy/close action)
   * @calls    src/ui/DomOverlay.ts → teardown, then the launching scene's onClose callback
   */
  close(): void {
    if (!this.isOpen()) return;
    const cb = this.onCloseCb;
    this.teardown();
    if (cb) cb();
  }

  /**
   * @function    destroy
   * @description Force-close without firing onClose — for when the launching scene is itself shutting down or hot-reloading and must drop the panel silently; no-op if already closed.
   * @calledby the launching scene on shutdown / hot-reload teardown
   * @calls    src/ui/DomOverlay.ts → teardown only
   */
  destroy(): void {
    if (!this.isOpen()) return;
    this.teardown();
  }

  /** Arm the close callback; a subclass open() calls this first, then builds DOM and attaches keyboard. */
  protected openShell(onClose: () => void): void {
    this.onCloseCb = onClose;
  }

  /**
   * @function    createBackdrop
   * @description Create the dim backdrop (closes on outside-click) and an empty framed window for the subclass to fill.
   * @param   windowClassName  CSS class for the inner framed window.
   * @returns an { overlay, win } pair — overlay the dim backdrop, win the empty window to populate.
   * @calledby a subclass while it builds its panel DOM
   * @calls    the DOM element-create API; wires the backdrop's outside-click to close
   */
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

  /** Append the built overlay to the #game parent and record it as open. */
  protected mount(overlay: HTMLDivElement): void {
    this.parent.appendChild(overlay);
    this.overlayEl = overlay;
  }

  /** Window-level capture-phase key handler; the subclass decides which keys it handles. */
  protected abstract onKeydown(e: KeyboardEvent): void;

  /** Hook for subclass teardown before the shell DOM is removed (release previews, refs, etc.). */
  protected onTeardown(): void {}

  /**
   * @function    attachKeyboard
   * @description Arm the window-level capture-phase keydown listener that forwards to the subclass onKeydown.
   * @calledby a subclass while it finishes opening its panel
   * @calls    the DOM addEventListener (capture phase)
   */
  protected attachKeyboard(): void {
    const handler = (e: KeyboardEvent): void => this.onKeydown(e);
    window.addEventListener('keydown', handler, true);
    this.keydownHandler = handler;
  }

  /**
   * @function    detachKeyboard
   * @description Remove the window keydown listener and clear its ref; no-op if none armed.
   * @calledby src/ui/DomOverlay.ts → teardown
   * @calls    the DOM removeEventListener
   */
  private detachKeyboard(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }

  /**
   * @function    teardown
   * @description Fully dismantle the open panel — release the keyboard listener, run the subclass hook, remove the DOM, clear the callback.
   * @calledby src/ui/DomOverlay.ts → close and destroy
   * @calls    src/ui/DomOverlay.ts → detachKeyboard and onTeardown, plus DOM removal
   */
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
