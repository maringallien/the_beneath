// Developer overlay for the navigation graph. Toggled with a key (wired in
// GameScene); draws the standable nodes + their edges within the camera view
// (walk = blue, jump = orange) plus any active enemy paths (yellow). Drawing is
// camera-culled so it forces edge computation only for on-screen nodes. Purely a
// debugging/tuning aid — never shown in normal play.

import Phaser from 'phaser';
import type { NavGraph } from './NavGraph';

const NODE_COLOR = 0x33ff99;
const WALK_EDGE_COLOR = 0x2266aa;
const JUMP_EDGE_COLOR = 0xcc6622;
const PATH_COLOR = 0xffee44;
const OVERLAY_DEPTH = 100000;

export interface NavPathLike {
  readonly x: number;
  readonly y: number;
}

export class NavDebugOverlay {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private shown = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly graph: NavGraph,
  ) {
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(OVERLAY_DEPTH);
    this.gfx.setVisible(false);
  }

  toggle(): void {
    this.setVisible(!this.shown);
  }

  setVisible(v: boolean): void {
    this.shown = v;
    this.gfx.setVisible(v);
    if (!v) this.gfx.clear();
  }

  isVisible(): boolean {
    return this.shown;
  }

  destroy(): void {
    this.gfx.destroy();
  }

  // Redraw for the current camera. `paths` are active enemy node paths to
  // highlight. No-op while hidden.
  render(paths: ReadonlyArray<ReadonlyArray<NavPathLike>>): void {
    if (!this.shown) return;
    const g = this.gfx;
    g.clear();
    const view = this.scene.cameras.main.worldView;
    const minX = view.x - 32;
    const maxX = view.right + 32;
    const minY = view.y - 32;
    const maxY = view.bottom + 32;
    const nodes = this.graph.getNodes();

    for (const n of nodes) {
      if (n.x < minX || n.x > maxX || n.y < minY || n.y > maxY) continue;
      for (const e of this.graph.getEdges(n.id)) {
        const t = this.graph.node(e.to);
        g.lineStyle(1, e.kind === 'jump' ? JUMP_EDGE_COLOR : WALK_EDGE_COLOR, 0.5);
        g.beginPath();
        g.moveTo(n.x, n.y);
        g.lineTo(t.x, t.y);
        g.strokePath();
      }
    }
    for (const n of nodes) {
      if (n.x < minX || n.x > maxX || n.y < minY || n.y > maxY) continue;
      g.fillStyle(NODE_COLOR, 0.9);
      g.fillCircle(n.x, n.y, 2);
    }

    for (const p of paths) {
      if (p.length < 2) continue;
      g.lineStyle(2, PATH_COLOR, 0.95);
      g.beginPath();
      g.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) g.lineTo(p[i].x, p[i].y);
      g.strokePath();
      for (const pt of p) {
        g.fillStyle(PATH_COLOR, 1);
        g.fillCircle(pt.x, pt.y, 3);
      }
    }
  }
}
