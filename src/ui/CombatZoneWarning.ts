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

/**
 * CombatZoneWarning — screen-pinned "leaving combat zone" warning + countdown.
 *
 * Shown while the player strays outside an active boss arena. Three stacked
 * lines — headline, large seconds counter, hint — are authored in screen pixels
 * and converted to world space at CAMERA_ZOOM each frame, so they stay pinned
 * under camera scroll and render crisply at zoom (the same trick BossHud uses).
 * Visible only during an escape countdown; toggled and ticked by its owner.
 *
 * Inputs:  scene (for text objects + tweens); per-frame the integer seconds left
 *          and the active camera.
 * Outputs: three managed Phaser.Text lines and their fade-in tweens.
 * @calledby the gameplay scene's boss-leash logic, while the player is outside
 *           an active arena with the escape timer running.
 * @calls    the scene's text factory and tween manager.
 */
export class CombatZoneWarning {
  private readonly warningText: Phaser.GameObjects.Text;
  private readonly countdownText: Phaser.GameObjects.Text;
  private readonly subText: Phaser.GameObjects.Text;
  private readonly lines: ReadonlyArray<Phaser.GameObjects.Text>;
  private visible = false;
  // Dedup so the counter texture is only re-rasterized when the digit changes.
  private lastSeconds = -1;

  // Creates the three text lines (headline, counter, hint) hidden at the origin; update() positions them.
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

  // Shows or hides the overlay; on show fades in from alpha 0 and resets the digit dedup.
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const line of this.lines) {
      this.scene.tweens.killTweensOf(line);
      line.setVisible(visible);
    }
    if (visible) {
      this.lastSeconds = -1; // force digit repaint even if unchanged since last show
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

  // Repositions the stacked lines in world space and refreshes the counter digit; no-op while hidden.
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
    // Counter centered on anchor; headline above, hint below; gap in screen px ÷ zoom.
    const gap = BOSS_ESCAPE_LINE_GAP_PX / zoom;
    const warnH = this.warningText.displayHeight;
    const countH = this.countdownText.displayHeight;
    const subH = this.subText.displayHeight;

    this.countdownText.setPosition(cx, cy);
    this.warningText.setPosition(cx, cy - countH * 0.5 - gap - warnH * 0.5);
    this.subText.setPosition(cx, cy + countH * 0.5 + gap + subH * 0.5);
  }

  // Tears down: cancels each line's tweens and destroys its text object.
  destroy(): void {
    for (const line of this.lines) {
      this.scene.tweens.killTweensOf(line);
      line.destroy();
    }
  }
}
