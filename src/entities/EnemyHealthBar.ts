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
 * EnemyHealthBar — a floating combat health bar painted above an Enemy.
 *
 * One Graphics object that draws a small bar in WORLD space (no scroll-factor
 * override) at the owning enemy's anchor, so the camera scrolls past it like any
 * sprite. A leaf module the enemy AI calls into: it follows a per-tick body
 * anchor and de-dups redraws (skipping draws when neither position nor HP
 * fraction changed), and never reads private Enemy state — kept out of the ~2k-
 * line Enemy.ts on purpose. The owner feeds the anchor (body.center.x +
 * body.top) each tick so the bar tracks the offsets a frame swap re-applies, and
 * disposes it via the owner's DESTROY listener so HMR teardown reclaims it.
 *
 * Inputs:  the scene (to create the Graphics), an optional per-entity vertical
 *          nudge, and per-tick anchor / HP-fraction / visibility from the owner.
 * Outputs: Graphics draw calls; owns nothing of the enemy's state.
 * @calledby an Enemy's per-frame update and damage/visibility transitions.
 * @calls    the scene's Graphics object and the shared bar tuning constants.
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

  // creates the hidden bar Graphics; explicit destroy() matters for HMR teardown
  constructor(scene: Phaser.Scene, extraOffsetY = 0) {
    this.extraOffsetY = extraOffsetY;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(ENEMY_HEALTH_BAR_DEPTH);
    this.graphics.setVisible(false);
  }

  // records the enemy's current position; redraws if visible, skips if unchanged
  setAnchor(centerX: number, bodyTop: number): void {
    if (centerX === this.centerX && bodyTop === this.bodyTop) return;
    this.centerX = centerX;
    this.bodyTop = bodyTop;
    if (this.visible) this.redraw();
  }

  // Shows / hides the bar (redrawing on show); no-ops when already in that state.
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.graphics.setVisible(visible);
    if (visible) this.redraw();
  }

  // records the HP fraction, redrawing if visible; skips if unchanged; max ≤ 0 yields ratio 0
  setHealth(current: number, max: number): void {
    const ratio = max > 0 ? Phaser.Math.Clamp(current / max, 0, 1) : 0;
    if (ratio === this.lastRenderedRatio) return;
    this.lastRenderedRatio = ratio;
    if (this.visible) this.redraw();
  }

  // Destroys the backing Graphics (explicit so HMR teardown reclaims it).
  destroy(): void {
    this.graphics.destroy();
  }

  // repaints background, foreground fill, and outline at the cached world position
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
