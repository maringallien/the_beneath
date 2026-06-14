import './detectionCorners.css';

// Aggregated detection readout the corner brackets reflect:
//   - clear:         no enemy is aware of the player (all Normal) → faint white.
//   - investigating: at least one enemy has spotted the player    → yellow.
//   - conflict:      at least one enemy is engaging directly        → red.
export type DetectionCornersLevel = 'clear' | 'investigating' | 'conflict';

/**
 * @file ui/DetectionCorners.ts
 * @description Four viewport-edge L-shaped alert brackets (sibling DOM overlay to the player HUD) recoloured each frame from the highest enemy alert level via a single is-* root class; pointer-events none so it never eats gameplay input.
 * @module ui
 */
export class DetectionCorners {
  private readonly parent: HTMLElement;
  private rootEl: HTMLDivElement | null = null;
  // Last applied level, so setLevel only touches the DOM on a real change
  // (it's called every render frame).
  private lastLevel: DetectionCornersLevel | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.buildDom();
  }

  /**
   * @function    setLevel
   * @description Swap the root's is-* class to reflect the alert level; dedup'd so steady state touches no DOM, and CSS animates the colour transition.
   * @param   level  Aggregate alert level: clear / investigating / conflict.
   * @calledby src/scenes/gameHud.ts → updateDetectionCorners, fed the highest enemy alert level each render frame
   * @calls    the DOM classList only
   */
  setLevel(level: DetectionCornersLevel): void {
    if (!this.rootEl || level === this.lastLevel) return;
    this.lastLevel = level;
    this.rootEl.classList.remove('is-clear', 'is-investigating', 'is-conflict');
    this.rootEl.classList.add(`is-${level}`);
  }

  /** Show/hide the overlay; hidden while the scene is paused so the dim covers it, mirroring the player HUD. */
  setVisible(visible: boolean): void {
    if (!this.rootEl) return;
    this.rootEl.style.display = visible ? '' : 'none';
  }

  /** Remove the DOM node and clear references; called on Quit-to-title and scene shutdown, alongside the player/boss HUDs. */
  destroy(): void {
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    this.lastLevel = null;
  }

  /**
   * @function    buildDom
   * @description Build the four corner-bracket divs under an is-clear root and append it to the parent.
   * @calledby src/ui/DetectionCorners.ts → constructor, at scene start
   * @calls    the DOM element-create/append API only
   */
  private buildDom(): void {
    const root = document.createElement('div');
    root.className = 'detection-corners is-clear';
    for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
      const bracket = document.createElement('div');
      bracket.className = `detection-corner detection-corner--${pos}`;
      root.appendChild(bracket);
    }
    this.parent.appendChild(root);
    this.rootEl = root;
  }
}
