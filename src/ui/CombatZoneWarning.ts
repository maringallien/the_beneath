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
 * @file ui/CombatZoneWarning.ts
 * @description Screen-pinned "leaving combat zone" warning + countdown shown while the player strays outside an active boss arena — three stacked lines authored in screen px and converted to world space at CAMERA_ZOOM each frame so they stay pinned under camera scroll and render crisply at zoom.
 * @module ui
 */
export class CombatZoneWarning {
  private readonly warningText: Phaser.GameObjects.Text;
  private readonly countdownText: Phaser.GameObjects.Text;
  private readonly subText: Phaser.GameObjects.Text;
  private readonly lines: ReadonlyArray<Phaser.GameObjects.Text>;
  private visible = false;
  // Dedup so the counter texture is only re-rasterized when the digit changes.
  private lastSeconds = -1;

  /**
   * @function    constructor
   * @description Create the three text lines (headline, counter, hint) centred, depth-set, and zoom-resolution, hidden at the origin until update positions them.
   * @param   scene  Owning scene; provides the text factory and is stored for later tween/positioning use.
   * @calledby src/scenes/gameHud.ts → the GameHud rig building its HUD for an arena
   * @calls    the scene's text factory and per-line origin/depth/resolution setup
   */
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

  /**
   * @function    setVisible
   * @description Show or hide the overlay; on show, fade in from alpha 0 and reset the digit dedup. No-op if unchanged.
   * @param   visible  True to reveal, false to hide.
   * @calledby src/scenes/gameHud.ts → setEscapeWarningVisible, as the player enters/leaves the escape countdown
   * @calls    the scene's tween manager to cancel old tweens and fade the lines in
   */
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

  /**
   * @function    update
   * @description Reposition the stacked lines in world space and re-rasterize the counter only when the digit changes; no-op while hidden.
   * @param   secondsLeft  Integer seconds remaining (clamped at 0).
   * @param   camera       Active camera, for the screen-to-world mapping.
   * @calledby src/scenes/gameHud.ts → updateCombatWarning, each frame while the countdown is visible
   * @calls    the lines' position/text setters; no further delegation
   */
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

  /**
   * @function    destroy
   * @description Tear down — cancel each line's tweens and destroy its text object.
   * @calledby src/scenes/gameHud.ts → destroy / destroyForSceneShutdown
   * @calls    the scene's tween manager and each text object's destroy
   */
  destroy(): void {
    for (const line of this.lines) {
      this.scene.tweens.killTweensOf(line);
      line.destroy();
    }
  }
}
