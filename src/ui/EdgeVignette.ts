import Phaser from 'phaser';
import {
  LANDING_VIGNETTE_COLOR,
  LANDING_VIGNETTE_EDGE_ALPHA,
  LANDING_VIGNETTE_THICKNESS_PX,
  VIGNETTE_CLEAR_FRACTION,
  VIGNETTE_DEPTH,
} from '../constants';

// Largest fraction of an axis a single edge strip may cover, derived so the
// central VIGNETTE_CLEAR_FRACTION of that axis is left untouched: the two
// opposing strips split the remaining (1 − clear) border between them.
const MAX_STRIP_AXIS_FRACTION = (1 - VIGNETTE_CLEAR_FRACTION) / 2;

// In-game screen-edge vignette: the exact darkening from the landing screen
// (LandingScene.drawVignette) applied over live gameplay. Four black gradient
// strips run along each viewport edge, fading from LANDING_VIGNETTE_EDGE_ALPHA
// at the outside edge to 0 at LANDING_VIGNETTE_THICKNESS_PX inward; corners
// take a double dose where adjacent strips overlap, reading as a slightly
// stronger vignette in the corners.
//
// Unlike the landing scene — whose camera has no zoom, so it can draw straight
// in canvas pixels — GameScene's main camera follows the player at CAMERA_ZOOM.
// So, exactly like BossHud, the strips are authored in screen pixels and
// converted to world space against the live camera each frame. That keeps the
// vignette pinned to the viewport (no scroll drift) and identical in on-screen
// thickness to the home screen regardless of zoom or window size.
export class EdgeVignette {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private visible = true;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(VIGNETTE_DEPTH);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.graphics.setVisible(visible);
    if (!visible) this.graphics.clear();
  }

  // Redraws the four edge strips in world space for the current camera frame.
  // Called from GameScene's PRE_RENDER driver so the rects track the camera's
  // scroll after this frame's follow lerp has been applied.
  //
  // thicknessPx and edgeAlpha are screen-space (the caller drives them from the
  // live terrain-density mapping); they default to the landing-screen set point
  // so the vignette stays identical to the home screen when no dynamic value is
  // supplied.
  update(
    camera: Phaser.Cameras.Scene2D.Camera,
    thicknessPx: number = LANDING_VIGNETTE_THICKNESS_PX,
    edgeAlpha: number = LANDING_VIGNETTE_EDGE_ALPHA,
  ): void {
    if (!this.visible) return;

    const halfW = camera.width * 0.5;
    const halfH = camera.height * 0.5;
    const zoom = camera.zoom;
    const midX = camera.midPoint.x;
    const midY = camera.midPoint.y;
    const toWorldX = (screenX: number): number => midX + (screenX - halfW) / zoom;
    const toWorldY = (screenY: number): number => midY + (screenY - halfH) / zoom;
    const worldLen = (screenPx: number): number => screenPx / zoom;

    // Viewport rect in world space (top-left origin).
    const x = toWorldX(0);
    const y = toWorldY(0);
    const w = worldLen(camera.width);
    const h = worldLen(camera.height);

    // Per-axis strip thickness, each capped so the central VIGNETTE_CLEAR_FRACTION
    // of that axis is never touched — the strips fade to zero exactly at the
    // clear-zone boundary, so the whole central rectangle is hard-zero vignette
    // regardless of how thick the density driver pushes it or how short the
    // window is. top/bottom are bounded by the height, left/right by the width
    // (so the side strips can be wider in px than the top/bottom ones on a wide
    // window, matching the viewport's aspect). Converted from screen px to world
    // units last so the on-screen band reads the same as the landing vignette.
    const tTB = worldLen(
      Math.min(thicknessPx, camera.height * MAX_STRIP_AXIS_FRACTION),
    );
    const tLR = worldLen(
      Math.min(thicknessPx, camera.width * MAX_STRIP_AXIS_FRACTION),
    );

    const color = LANDING_VIGNETTE_COLOR;
    const a = edgeAlpha;
    const g = this.graphics;
    g.clear();

    // Top: opaque at the top edge → transparent at the inner edge.
    g.fillGradientStyle(color, color, color, color, a, a, 0, 0);
    g.fillRect(x, y, w, tTB);

    // Bottom: transparent at the inner edge → opaque at the bottom edge.
    g.fillGradientStyle(color, color, color, color, 0, 0, a, a);
    g.fillRect(x, y + h - tTB, w, tTB);

    // Left: opaque at the left edge → transparent at the inner edge.
    g.fillGradientStyle(color, color, color, color, a, 0, a, 0);
    g.fillRect(x, y, tLR, h);

    // Right: transparent at the inner edge → opaque at the right edge.
    g.fillGradientStyle(color, color, color, color, 0, a, 0, a);
    g.fillRect(x + w - tLR, y, tLR, h);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
