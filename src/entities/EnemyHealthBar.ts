import Phaser from 'phaser';
import {
  ENEMY_HEALTH_BAR_BG_ALPHA,
  ENEMY_HEALTH_BAR_BG_COLOR,
  ENEMY_HEALTH_BAR_DEPTH,
  ENEMY_HEALTH_BAR_FG_COLOR,
  ENEMY_HEALTH_BAR_HEIGHT_PX,
  ENEMY_HEALTH_BAR_OFFSET_Y_PX,
  ENEMY_HEALTH_BAR_OUTLINE_COLOR,
  ENEMY_HEALTH_BAR_WIDTH_PX,
} from '../constants';

/**
 * @file entities/EnemyHealthBar.ts
 * @description Floating combat health bar painted above an Enemy. One Graphics object drawing a small bar in WORLD space (no scroll-factor override) at the owner's anchor, so the camera scrolls past it like any sprite. A leaf the enemy AI calls into: it follows a per-tick body anchor, de-dups redraws (skips when neither position nor HP fraction changed), and never reads private Enemy state — kept out of the ~2k-line Enemy.ts on purpose. The owner feeds the anchor (body.center.x + body.top) each tick so the bar tracks the offsets a frame swap re-applies, and disposes it via the owner's DESTROY listener so HMR teardown reclaims it.
 * @module entities
 */
export class EnemyHealthBar {
  private readonly graphics: Phaser.GameObjects.Graphics;
  // -1 sentinel forces the first setHealth to always redraw
  private lastRenderedRatio = -1;
  // cached position so a position-change while hidden still syncs on show
  private centerX = 0;
  private bodyTop = 0;
  private visible = false;
  // positive raises the bar for sprites whose visible top sits above the physics body top
  private readonly extraOffsetY: number;

  /**
   * @function    constructor
   * @description Creates the hidden bar Graphics; explicit destroy matters for HMR teardown.
   * @param   scene         Creates the Graphics.
   * @param   extraOffsetY  Px to raise the bar for sprites whose visible top sits above the body top; default 0.
   * @calledby src/entities/Enemy.ts → when an enemy spawns and wants a floating HP bar
   * @calls    the scene's graphics factory
   */
  constructor(scene: Phaser.Scene, extraOffsetY = 0) {
    this.extraOffsetY = extraOffsetY;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(ENEMY_HEALTH_BAR_DEPTH);
    this.graphics.setVisible(false);
  }

  /**
   * @function    setAnchor
   * @description Records the enemy's current position; redraws if visible, skips if unchanged.
   * @param   centerX  World-px body center.
   * @param   bodyTop  World-px body top edge.
   * @calledby src/entities/Enemy.ts → the owning enemy's per-frame update, feeding the body anchor
   * @calls    the private redraw when visible; no-ops if the anchor is unchanged
   */
  setAnchor(centerX: number, bodyTop: number): void {
    if (centerX === this.centerX && bodyTop === this.bodyTop) return;
    this.centerX = centerX;
    this.bodyTop = bodyTop;
    if (this.visible) this.redraw();
  }

  /**
   * @function    setVisible
   * @description Shows / hides the bar (redrawing on show); no-ops when already in that state.
   * @param   visible  Target visibility.
   * @calledby src/entities/Enemy.ts → on aggro/damage start and when the bar should hide
   * @calls    the private redraw on show
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.graphics.setVisible(visible);
    if (visible) this.redraw();
  }

  /**
   * @function    setHealth
   * @description Records the HP fraction, redrawing if visible; skips if unchanged.
   * @param   current  Current HP.
   * @param   max      Max HP; <= 0 yields a clamped ratio of 0.
   * @calledby src/entities/Enemy.ts → on every damage/heal transition
   * @calls    Phaser's clamp, then the private redraw when visible
   */
  setHealth(current: number, max: number): void {
    const ratio = max > 0 ? Phaser.Math.Clamp(current / max, 0, 1) : 0;
    if (ratio === this.lastRenderedRatio) return;
    this.lastRenderedRatio = ratio;
    if (this.visible) this.redraw();
  }

  /** Destroys the backing Graphics (explicit so HMR teardown reclaims it). */
  destroy(): void {
    this.graphics.destroy();
  }

  /**
   * @function    redraw
   * @description Repaints background, foreground fill, and outline at the cached world position.
   * @calledby src/entities/EnemyHealthBar.ts → the setters above, whenever a visible bar's anchor or HP changed
   * @calls    Phaser Graphics fill/line/stroke primitives only
   */
  private redraw(): void {
    const g = this.graphics;
    g.clear();
    const w = ENEMY_HEALTH_BAR_WIDTH_PX;
    const h = ENEMY_HEALTH_BAR_HEIGHT_PX;
    // drawn in world coords so the bar tracks the enemy through camera scroll
    const x = this.centerX - w / 2;
    const y = this.bodyTop - ENEMY_HEALTH_BAR_OFFSET_Y_PX - this.extraOffsetY - h;
    g.fillStyle(ENEMY_HEALTH_BAR_BG_COLOR, ENEMY_HEALTH_BAR_BG_ALPHA);
    g.fillRect(x, y, w, h);
    // ratio 0 still shows the dark BG so the bar stays legible at near-death
    const ratio = this.lastRenderedRatio < 0 ? 1 : this.lastRenderedRatio;
    if (ratio > 0) {
      g.fillStyle(ENEMY_HEALTH_BAR_FG_COLOR, 1);
      g.fillRect(x, y, w * ratio, h);
    }
    g.lineStyle(1, ENEMY_HEALTH_BAR_OUTLINE_COLOR, 1);
    g.strokeRect(x, y, w, h);
  }
}
