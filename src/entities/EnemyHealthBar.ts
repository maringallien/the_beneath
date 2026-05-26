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

// Floating combat health bar painted above an Enemy's body.top. Owned per-
// Enemy and disposed via the owner's DESTROY listener so HMR teardown reclaims
// the Graphics object alongside the sprite it tracks. Drawn into world space
// (no setScrollFactor(0)) — the bar lives at the enemy's position and the
// camera scrolls past it like any other sprite.
//
// Why a dedicated class instead of a few lines inside Enemy:
//   - Enemy.ts already sits at ~2k lines (well past the 800-line guideline);
//     piling more on it makes a hard-to-navigate file harder.
//   - The "follow body.top + dedup redraws" loop is self-contained and never
//     reads private Enemy state, so it can be a leaf module the AI code calls
//     into rather than another concern interleaved into the state machine.
//
// Owner contract: the caller provides a body anchor each tick via update(...)
// (body.center.x + body.top), so the bar tracks anchor changes that the
// physics body emits when an animation-frame swap re-runs applyAnimationAnchor.
export class EnemyHealthBar {
  private readonly graphics: Phaser.GameObjects.Graphics;
  // Last rendered HP fraction in [0, 1]. Compared against incoming values so
  // we only re-issue draw calls when the bar actually changes — matches the
  // lastRenderedHealth pattern GameScene.updateHud already uses for the
  // player HP readout. Initial -1 forces the first setHealth to redraw.
  private lastRenderedRatio = -1;
  // Cached center-X / body-top so we can repaint a hidden bar at a stale
  // position if HP changes before the next update tick — keeps the draw and
  // the position in sync without two separate redraw paths.
  private centerX = 0;
  private bodyTop = 0;
  private visible = false;
  // Per-entity vertical nudge in source pixels. Positive = bar sits HIGHER
  // above body.top, on top of the default ENEMY_HEALTH_BAR_OFFSET_Y_PX gap.
  // Used by entities whose visible top is well above the physics body's top
  // (oversized frames with the body anchored low).
  private readonly extraOffsetY: number;

  constructor(scene: Phaser.Scene, extraOffsetY = 0) {
    this.extraOffsetY = extraOffsetY;
    // add.graphics() registers the object with the scene's display list and
    // update list; Phaser's scene shutdown destroys it automatically, but
    // we still wire an explicit destroy() so HMR teardown (which clears the
    // enemies group without restarting the whole scene) reclaims the slot.
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(ENEMY_HEALTH_BAR_DEPTH);
    this.graphics.setVisible(false);
  }

  // Updates the position the bar will paint at. Called every frame from
  // Enemy.update so a moving / animating enemy stays anchored — even while
  // the bar is hidden, so the moment it flips visible it appears at the
  // correct spot rather than where the enemy was 20 s ago.
  setAnchor(centerX: number, bodyTop: number): void {
    if (centerX === this.centerX && bodyTop === this.bodyTop) return;
    this.centerX = centerX;
    this.bodyTop = bodyTop;
    if (this.visible) this.redraw();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.graphics.setVisible(visible);
    if (visible) this.redraw();
  }

  // Records the HP fraction. Skips the draw call when the fraction hasn't
  // changed since the last paint (a healthy enemy chased by the player for
  // 20 seconds would otherwise re-issue identical Graphics commands every
  // tick). Negative max defends against divide-by-zero from misconfigured
  // registry entries — we clamp to [0, 1] and let the validator catch the
  // misconfiguration at boot.
  setHealth(current: number, max: number): void {
    const ratio = max > 0 ? Phaser.Math.Clamp(current / max, 0, 1) : 0;
    if (ratio === this.lastRenderedRatio) return;
    this.lastRenderedRatio = ratio;
    if (this.visible) this.redraw();
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private redraw(): void {
    const g = this.graphics;
    g.clear();
    const w = ENEMY_HEALTH_BAR_WIDTH_PX;
    const h = ENEMY_HEALTH_BAR_HEIGHT_PX;
    // Bar's bottom edge sits OFFSET_Y above body.top, centered on body.center.x.
    // Drawing in world coords (the Graphics has no scroll-factor override) so
    // the bar tracks the enemy through camera scroll.
    const x = this.centerX - w / 2;
    const y = this.bodyTop - ENEMY_HEALTH_BAR_OFFSET_Y_PX - this.extraOffsetY - h;
    g.fillStyle(ENEMY_HEALTH_BAR_BG_COLOR, ENEMY_HEALTH_BAR_BG_ALPHA);
    g.fillRect(x, y, w, h);
    // Foreground fills from the left; ratio of 0 still leaves the dark BG
    // visible so the empty bar is legible right before death.
    const ratio = this.lastRenderedRatio < 0 ? 1 : this.lastRenderedRatio;
    if (ratio > 0) {
      g.fillStyle(ENEMY_HEALTH_BAR_FG_COLOR, 1);
      g.fillRect(x, y, w * ratio, h);
    }
    g.lineStyle(1, ENEMY_HEALTH_BAR_OUTLINE_COLOR, 1);
    g.strokeRect(x, y, w, h);
  }
}
