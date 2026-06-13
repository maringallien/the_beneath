import Phaser from 'phaser';
import {
  CAMERA_ZOOM,
  ENEMY_ALERT_ICON_DEPTH,
  ENEMY_ALERT_ICON_DETECT_COLOR,
  ENEMY_ALERT_ICON_HEIGHT_PX,
  ENEMY_ALERT_ICON_OFFSET_Y_PX,
  ENEMY_ALERT_ICON_SUSPECT_COLOR,
} from '../constants';

// What the icon paints. 'none' hides it; 'suspect' is the yellow "?" (spotted /
// investigating), 'detect' is the red "!" (engaging).
export type AlertGlyph = 'none' | 'suspect' | 'detect';

// 0xRRGGBB → "#rrggbb" for Phaser.Text's CSS colour fields.
function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

const SUSPECT_CSS = cssColor(ENEMY_ALERT_ICON_SUSPECT_COLOR);
const DETECT_CSS = cssColor(ENEMY_ALERT_ICON_DETECT_COLOR);

/**
 * EnemyAlertIcon — floating "?"/"!" detection glyph painted above an Enemy's head.
 *
 * Mirrors EnemyHealthBar: owned per-Enemy, anchored to body.top each tick, drawn
 * in world space (no scroll-factor override) so the camera scrolls past it, and
 * disposed via the owner's DESTROY listener so HMR teardown reclaims it. It is
 * event-driven, not a state mirror: the owner escalates by setting a glyph and
 * clears it after a short hold, so the glyph is a momentary tell (a yellow "?"
 * flash on spotting, a red "!" flash on engaging) rather than a persistent label.
 * Rendered as Phaser Text at the camera's zoom resolution so it stays crisp at
 * CAMERA_ZOOM instead of a 1× canvas magnified 3×.
 *
 * Inputs:  the owning scene (for the Text object) plus per-frame anchor + glyph
 *          calls from the owner.
 * Outputs: one managed Phaser.Text drawn above the enemy; nothing else.
 * @calledby an enemy that owns a detection tell, constructing and driving it each
 *           frame and on alert escalations.
 * @calls    Phaser's text factory and the alert-icon tuning constants.
 */
export class EnemyAlertIcon {
  private readonly text: Phaser.GameObjects.Text;
  // dedupe guard — only updates the Text on an actual glyph change
  private current: AlertGlyph = 'none';
  // cached position so the glyph appears at the right spot the instant it's shown
  private centerX = 0;
  private bodyTop = 0;

  // creates the hidden glyph Text at CAMERA_ZOOM resolution for crispness
  constructor(scene: Phaser.Scene) {
    this.text = scene.add.text(0, 0, '', {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontStyle: 'bold',
      fontSize: `${ENEMY_ALERT_ICON_HEIGHT_PX}px`,
      color: DETECT_CSS,
      stroke: '#000000',
      strokeThickness: 2,
    });
    this.text.setOrigin(0.5, 1);
    this.text.setResolution(CAMERA_ZOOM);
    this.text.setDepth(ENEMY_ALERT_ICON_DEPTH);
    this.text.setVisible(false);
  }

  // caches the body anchor each frame; repositions live only when a glyph is visible
  setAnchor(centerX: number, bodyTop: number): void {
    if (centerX === this.centerX && bodyTop === this.bodyTop) return;
    this.centerX = centerX;
    this.bodyTop = bodyTop;
    if (this.current !== 'none') this.reposition();
  }

  // shows "!" or "?" in the right colour, or hides on 'none'; no-op if unchanged
  setGlyph(glyph: AlertGlyph): void {
    if (glyph === this.current) return;
    this.current = glyph;
    if (glyph === 'none') {
      this.text.setVisible(false);
      return;
    }
    const detect = glyph === 'detect';
    this.text.setText(detect ? '!' : '?');
    this.text.setColor(detect ? DETECT_CSS : SUSPECT_CSS);
    this.reposition();
    this.text.setVisible(true);
  }

  // Releases the backing Text; called from the owner's destroy/HMR teardown.
  destroy(): void {
    this.text.destroy();
  }

  // Moves the Text to the cached anchor, floated ENEMY_ALERT_ICON_OFFSET_Y_PX up.
  private reposition(): void {
    this.text.setPosition(
      this.centerX,
      this.bodyTop - ENEMY_ALERT_ICON_OFFSET_Y_PX,
    );
  }
}
