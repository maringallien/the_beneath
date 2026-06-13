import './detectionCorners.css';

// Aggregated detection readout the corner brackets reflect:
//   - clear:         no enemy is aware of the player (all Normal) → faint white.
//   - investigating: at least one enemy has spotted the player    → yellow.
//   - conflict:      at least one enemy is engaging directly        → red.
export type DetectionCornersLevel = 'clear' | 'investigating' | 'conflict';

/**
 * DetectionCorners — the four viewport-edge alert brackets.
 *
 * Four L-shaped corner brackets pinned to the viewport edges, layered over the
 * Phaser canvas in the same #game parent as the player HUD (a sibling DOM
 * overlay, so the monochrome HUD panels are untouched). They are recoloured each
 * frame from the highest enemy alert level: faint white when the player is
 * unseen, yellow while an enemy investigates, red in an active fight. Styled
 * like the HUD — the level is a single class on the root (is-clear /
 * is-investigating / is-conflict) that the brackets read via their border
 * colour, so a state change is one class swap and CSS animates the transition;
 * pointer-events:none so it never eats gameplay input.
 *
 * Inputs:  the #game parent element; a per-frame detection level and visibility.
 * Outputs: a DOM subtree whose root class encodes the current alert level.
 * @calledby the gameplay scene — built at scene start, fed the aggregate alert
 *           level each frame, hidden while paused, and torn down on shutdown.
 * @calls    the DOM (element create/append/remove, classList) only.
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

  // Swaps the root's is-* class to reflect the alert level; dedup'd so steady state touches no DOM.
  setLevel(level: DetectionCornersLevel): void {
    if (!this.rootEl || level === this.lastLevel) return;
    this.lastLevel = level;
    this.rootEl.classList.remove('is-clear', 'is-investigating', 'is-conflict');
    this.rootEl.classList.add(`is-${level}`);
  }

  // Show/hide the overlay. GameScene hides it while the scene is paused
  // (pause/shop/options) so it's covered by the dim, mirroring the player HUD.
  setVisible(visible: boolean): void {
    if (!this.rootEl) return;
    this.rootEl.style.display = visible ? '' : 'none';
  }

  // Removes the DOM node and clears references. Called on Quit-to-title and on
  // scene shutdown, alongside the player/boss HUDs.
  destroy(): void {
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    this.lastLevel = null;
  }

  // Builds the four corner bracket divs under a root with is-clear default and appends to parent.
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
