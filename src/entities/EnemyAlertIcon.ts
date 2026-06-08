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

// Floating "?"/"!" detection glyph painted above an Enemy's head, mirroring
// EnemyHealthBar: owned per-Enemy, anchored to body.top each tick, drawn in
// world space (no scroll-factor override) so the camera scrolls past it, and
// disposed via the owner's DESTROY listener so HMR teardown reclaims it.
//
// Event-driven, not a state mirror: the owner (Enemy) calls setGlyph on an
// escalation and clears it after a short hold, so the glyph is a momentary tell
// (a yellow "?" flash on spotting, a red "!" flash on engaging) rather than a
// persistent label. Rendered as Phaser Text at the camera's zoom resolution so
// it stays crisp at CAMERA_ZOOM instead of a 1× canvas magnified 3×.
export class EnemyAlertIcon {
  private readonly text: Phaser.GameObjects.Text;
  // Last glyph applied, so setGlyph only touches the Text on an actual change.
  private current: AlertGlyph = 'none';
  // Cached anchor so the glyph tracks the moving body and pops up at the right
  // spot the instant it's shown — mirrors EnemyHealthBar.
  private centerX = 0;
  private bodyTop = 0;

  constructor(scene: Phaser.Scene) {
    this.text = scene.add.text(0, 0, '', {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontStyle: 'bold',
      fontSize: `${ENEMY_ALERT_ICON_HEIGHT_PX}px`,
      color: DETECT_CSS,
      // Dark outline keeps the glyph legible over bright tiles, matching the
      // health bar's black outline.
      stroke: '#000000',
      strokeThickness: 2,
    });
    // Anchor at the glyph's bottom-centre so it floats a fixed gap above
    // body.top regardless of glyph height.
    this.text.setOrigin(0.5, 1);
    this.text.setResolution(CAMERA_ZOOM);
    this.text.setDepth(ENEMY_ALERT_ICON_DEPTH);
    this.text.setVisible(false);
  }

  // Updates the anchor the glyph paints above. Called every frame from
  // Enemy.update so a moving/animating enemy stays tracked even while hidden.
  setAnchor(centerX: number, bodyTop: number): void {
    if (centerX === this.centerX && bodyTop === this.bodyTop) return;
    this.centerX = centerX;
    this.bodyTop = bodyTop;
    if (this.current !== 'none') this.reposition();
  }

  // Shows the given glyph (or hides on 'none'). No-op when unchanged.
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

  destroy(): void {
    this.text.destroy();
  }

  private reposition(): void {
    this.text.setPosition(
      this.centerX,
      this.bodyTop - ENEMY_ALERT_ICON_OFFSET_Y_PX,
    );
  }
}
