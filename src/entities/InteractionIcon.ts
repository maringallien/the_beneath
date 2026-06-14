import Phaser from 'phaser';
import {
  CAMERA_ZOOM,
  INTERACTION_ICON_BG_COLOR,
  INTERACTION_ICON_DEPTH,
  INTERACTION_ICON_FONT_FAMILY,
  INTERACTION_ICON_FONT_SIZE_PX,
  INTERACTION_ICON_LETTER_COLOR,
  INTERACTION_ICON_LETTER_SCALE,
  INTERACTION_ICON_PROGRESS_COLOR,
  INTERACTION_ICON_PROGRESS_EDGE_OFFSET_PX,
  INTERACTION_ICON_PROGRESS_STROKE_PX,
  INTERACTION_ICON_SIZE_PX,
} from '../constants';

/**
 * @file entities/InteractionIcon.ts
 * @description World-anchored "press E" hold prompt: a filled white box with a smooth black "E", ringed by a clockwise square progress outline (just outside the box) that fills as the player holds E. Pure drawing — InteractionManager owns it and drives position, fade, and progress; this class only renders. The box and letter are drawn once at construction; setProgress redraws only the outline, dedupe-skipping tiny deltas so an idle prompt doesn't repaint the Graphics every frame.
 * @module entities
 */

// skip redraws smaller than this so an idle-at-0 prompt doesn't repaint every frame
const PROGRESS_REDRAW_EPSILON = 0.02;

export class InteractionIcon {
  private readonly container: Phaser.GameObjects.Container;
  private readonly progressGraphics: Phaser.GameObjects.Graphics;
  // -1 sentinel so the first setProgress(0) still redraws rather than being deduped
  private lastDrawnProgress = -1;

  /**
   * @function    constructor
   * @description Build the box + "E" + progress-ring container, starting hidden and transparent; the "E" is oversized and scaled down with a LINEAR filter for crisp anti-aliasing at the camera zoom.
   * @param   scene  Owning Phaser scene (for the container, Graphics, and text objects).
   * @calledby src/entities/InteractionManager.ts → constructor, once per scene
   * @calls    Phaser container/graphics/text construction only
   */
  constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0);
    this.container.setDepth(INTERACTION_ICON_DEPTH);

    const half = INTERACTION_ICON_SIZE_PX / 2;

    const boxGraphics = scene.add.graphics();
    boxGraphics.fillStyle(INTERACTION_ICON_BG_COLOR, 1);
    boxGraphics.fillRect(
      -half,
      -half,
      INTERACTION_ICON_SIZE_PX,
      INTERACTION_ICON_SIZE_PX,
    );

    const letter = scene.add.text(0, 0, 'E', {
      fontFamily: INTERACTION_ICON_FONT_FAMILY,
      fontSize: `${INTERACTION_ICON_FONT_SIZE_PX}px`,
      color: INTERACTION_ICON_LETTER_COLOR,
    });
    letter.setOrigin(0.5, 0.5);
    letter.setResolution(CAMERA_ZOOM);
    letter.setScale(INTERACTION_ICON_LETTER_SCALE);
    letter.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    this.progressGraphics = scene.add.graphics();

    this.container.add([boxGraphics, letter, this.progressGraphics]);
    this.container.setVisible(false);
    this.container.setAlpha(0);
  }

  /** Moves the icon's world-space center (the container origin). */
  setWorldPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  /** Sets the whole icon's opacity (the manager eases this for the fade). */
  setAlpha(a: number): void {
    this.container.setAlpha(a);
  }

  /** Shows/hides the whole icon. */
  setVisible(v: boolean): void {
    this.container.setVisible(v);
  }

  /**
   * @function    setProgress
   * @description Redraw the clockwise square outline to the given hold fraction, walking the perimeter segments (the top edge split at top-center) until the fill length is consumed; skips sub-epsilon deltas but always redraws cleanly at empty (0) and full (1).
   * @param   ratio  Hold fraction, clamped to 0-1.
   * @calledby src/entities/InteractionManager.ts → update each frame, with the current hold ratio
   * @calls    the Phaser Graphics drawing API and Phaser.Math.Clamp
   */
  setProgress(ratio: number): void {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    // always redraw at 0 and 1 so the outline lands cleanly on empty/full
    if (
      clamped !== 0 &&
      clamped !== 1 &&
      this.lastDrawnProgress >= 0 &&
      Math.abs(clamped - this.lastDrawnProgress) < PROGRESS_REDRAW_EPSILON
    ) {
      return;
    }
    this.lastDrawnProgress = clamped;

    this.progressGraphics.clear();
    if (clamped <= 0) return;

    // `target` is the total clockwise perimeter length to fill this frame
    const halfSide =
      INTERACTION_ICON_SIZE_PX / 2 + INTERACTION_ICON_PROGRESS_EDGE_OFFSET_PX;
    const side = halfSide * 2;
    const target = clamped * side * 4;

    // top edge is split into two halves (start/end at top-center); middle three are full edges
    const segments: ReadonlyArray<{
      endX: number;
      endY: number;
      length: number;
    }> = [
      { endX: halfSide, endY: -halfSide, length: halfSide },
      { endX: halfSide, endY: halfSide, length: side },
      { endX: -halfSide, endY: halfSide, length: side },
      { endX: -halfSide, endY: -halfSide, length: side },
      { endX: 0, endY: -halfSide, length: halfSide },
    ];

    this.progressGraphics.lineStyle(
      INTERACTION_ICON_PROGRESS_STROKE_PX,
      INTERACTION_ICON_PROGRESS_COLOR,
      1,
    );
    this.progressGraphics.beginPath();
    this.progressGraphics.moveTo(0, -halfSide);

    let consumed = 0;
    let prevX = 0;
    let prevY = -halfSide;
    for (const seg of segments) {
      const remaining = target - consumed;
      if (remaining <= 0) break;
      if (remaining >= seg.length) {
        this.progressGraphics.lineTo(seg.endX, seg.endY);
        consumed += seg.length;
        prevX = seg.endX;
        prevY = seg.endY;
      } else {
        const t = remaining / seg.length;
        const x = prevX + (seg.endX - prevX) * t;
        const y = prevY + (seg.endY - prevY) * t;
        this.progressGraphics.lineTo(x, y);
        break;
      }
    }

    this.progressGraphics.strokePath();
  }

  /** Destroys the container, which recursively frees the box, text, and Graphics. */
  destroy(): void {
    this.container.destroy();
  }
}
