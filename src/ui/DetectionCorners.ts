import './detectionCorners.css';

// Aggregated detection readout the corner brackets reflect:
//   - clear:         no enemy is aware of the player (all Normal) → faint white.
//   - investigating: at least one enemy has spotted the player    → yellow.
//   - conflict:      at least one enemy is engaging directly        → red.
export type DetectionCornersLevel = 'clear' | 'investigating' | 'conflict';

// Four L-shaped corner brackets pinned to the viewport edges, layered over the
// Phaser canvas in the same #game parent as the player HUD (a sibling DOM
// overlay, so the monochrome HUD panels are untouched). GameScene recolours them
// each frame from the highest enemy alert level — a faint white when the player
// is unseen, yellow while an enemy investigates, red in an active fight.
//
// DOM/CSS like the player HUD: the level is a single class on the root
// (is-clear / is-investigating / is-conflict) that the brackets read via their
// border-colour, so a state change is one class swap and CSS animates the
// transition. pointer-events:none so it never eats gameplay input.
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
