import Phaser from 'phaser';
import {
  BOSS_ESCAPE_COUNTDOWN_COLOR,
  BOSS_ESCAPE_COUNTDOWN_FONT_SIZE_PX,
  BOSS_ESCAPE_DEPTH,
  BOSS_ESCAPE_FADE_IN_MS,
  BOSS_ESCAPE_LINE_GAP_PX,
  BOSS_ESCAPE_SUBTEXT,
  BOSS_ESCAPE_SUBTEXT_COLOR,
  BOSS_ESCAPE_SUBTEXT_FONT_FAMILY,
  BOSS_ESCAPE_SUBTEXT_FONT_SIZE_PX,
  BOSS_ESCAPE_VIEWPORT_FRACTION_Y,
  BOSS_ESCAPE_WARNING_COLOR,
  BOSS_ESCAPE_WARNING_FONT_FAMILY,
  BOSS_ESCAPE_WARNING_FONT_SIZE_PX,
  BOSS_ESCAPE_WARNING_STROKE_COLOR,
  BOSS_ESCAPE_WARNING_STROKE_PX,
  BOSS_ESCAPE_WARNING_TEXT,
  CAMERA_ZOOM,
} from '../constants';

// Screen-pinned "leaving combat zone" warning + countdown, shown while the
// player is outside an active boss arena (driven by GameScene.updateBossLeash).
// Three stacked lines — headline, large seconds counter, hint — authored in
// screen pixels and converted to world space at CAMERA_ZOOM each frame so they
// stay pinned under camera scroll and render crisply at zoom, exactly like
// BossHud. Owned by GameScene; visible only during an escape countdown.
export class CombatZoneWarning {
  private readonly warningText: Phaser.GameObjects.Text;
  private readonly countdownText: Phaser.GameObjects.Text;
  private readonly subText: Phaser.GameObjects.Text;
  private readonly lines: ReadonlyArray<Phaser.GameObjects.Text>;
  private visible = false;
  // Dedup so the counter texture is only re-rasterized when the digit changes.
  private lastSeconds = -1;

  constructor(private readonly scene: Phaser.Scene) {
    this.warningText = scene.add.text(0, 0, BOSS_ESCAPE_WARNING_TEXT, {
      fontFamily: BOSS_ESCAPE_WARNING_FONT_FAMILY,
      fontSize: `${BOSS_ESCAPE_WARNING_FONT_SIZE_PX}px`,
      color: BOSS_ESCAPE_WARNING_COLOR,
      stroke: BOSS_ESCAPE_WARNING_STROKE_COLOR,
      strokeThickness: BOSS_ESCAPE_WARNING_STROKE_PX,
    });
    this.countdownText = scene.add.text(0, 0, '', {
      fontFamily: BOSS_ESCAPE_WARNING_FONT_FAMILY,
      fontSize: `${BOSS_ESCAPE_COUNTDOWN_FONT_SIZE_PX}px`,
      color: BOSS_ESCAPE_COUNTDOWN_COLOR,
      stroke: BOSS_ESCAPE_WARNING_STROKE_COLOR,
      strokeThickness: BOSS_ESCAPE_WARNING_STROKE_PX,
    });
    this.subText = scene.add.text(0, 0, BOSS_ESCAPE_SUBTEXT, {
      fontFamily: BOSS_ESCAPE_SUBTEXT_FONT_FAMILY,
      fontSize: `${BOSS_ESCAPE_SUBTEXT_FONT_SIZE_PX}px`,
      color: BOSS_ESCAPE_SUBTEXT_COLOR,
    });
    this.lines = [this.warningText, this.countdownText, this.subText];
    for (const line of this.lines) {
      line.setOrigin(0.5, 0.5);
      line.setDepth(BOSS_ESCAPE_DEPTH);
      line.setResolution(CAMERA_ZOOM);
      line.setVisible(false);
    }
  }

  // Toggles the whole overlay. On show, fades the lines in and forces a counter
  // repaint; on hide, kills any in-flight fade so a re-show starts clean. Deduped
  // so per-frame calls from GameScene are cheap.
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const line of this.lines) {
      this.scene.tweens.killTweensOf(line);
      line.setVisible(visible);
    }
    if (visible) {
      // Force the next update() to (re)write the digit even if it matches the
      // last value shown before the overlay was hidden.
      this.lastSeconds = -1;
      for (const line of this.lines) {
        line.setAlpha(0);
        this.scene.tweens.add({
          targets: line,
          alpha: 1,
          duration: BOSS_ESCAPE_FADE_IN_MS,
        });
      }
    }
  }

  // Repositions the stacked lines in world space and refreshes the counter.
  // No-op while hidden. secondsLeft is the integer countdown value (3 → 2 → 1).
  update(secondsLeft: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    if (!this.visible) return;

    const halfW = camera.width * 0.5;
    const halfH = camera.height * 0.5;
    const zoom = camera.zoom;
    const midX = camera.midPoint.x;
    const midY = camera.midPoint.y;
    const toWorldX = (screenX: number): number => midX + (screenX - halfW) / zoom;
    const toWorldY = (screenY: number): number => midY + (screenY - halfH) / zoom;

    if (secondsLeft !== this.lastSeconds) {
      this.countdownText.setText(String(Math.max(0, secondsLeft)));
      this.lastSeconds = secondsLeft;
    }

    const cx = toWorldX(camera.width * 0.5);
    const cy = toWorldY(camera.height * BOSS_ESCAPE_VIEWPORT_FRACTION_Y);
    // Stack around the anchor: counter centered on it, headline above, hint
    // below. displayHeight is already in world units (zoom-resolved); the gap is
    // screen px → world via ÷zoom so spacing holds at any zoom.
    const gap = BOSS_ESCAPE_LINE_GAP_PX / zoom;
    const warnH = this.warningText.displayHeight;
    const countH = this.countdownText.displayHeight;
    const subH = this.subText.displayHeight;

    this.countdownText.setPosition(cx, cy);
    this.warningText.setPosition(cx, cy - countH * 0.5 - gap - warnH * 0.5);
    this.subText.setPosition(cx, cy + countH * 0.5 + gap + subH * 0.5);
  }

  destroy(): void {
    for (const line of this.lines) {
      this.scene.tweens.killTweensOf(line);
      line.destroy();
    }
  }
}
