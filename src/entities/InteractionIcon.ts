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

// Minimum |ratio - lastDrawnRatio| required to trigger a perimeter redraw.
// Skipped when the fractional fill barely moves — keeps the idle-at-0 case
// from clearing+stroking the Graphics every frame.
const PROGRESS_REDRAW_EPSILON = 0.02;

// World-anchored "press E" prompt: filled white box with a smooth black "E"
// letter, with a clockwise square progress outline sitting just outside the
// box that fills as the player holds E. Owned by InteractionManager — the
// manager positions, fades, and sets progress; this class just draws.
export class InteractionIcon {
  private readonly container: Phaser.GameObjects.Container;
  private readonly progressGraphics: Phaser.GameObjects.Graphics;
  // -1 sentinel so the first setProgress(0) call still draws (clears) the
  // outline rather than being dedupe'd as a no-op.
  private lastDrawnProgress = -1;

  constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0);
    this.container.setDepth(INTERACTION_ICON_DEPTH);

    const half = INTERACTION_ICON_SIZE_PX / 2;

    // Box: drawn once at construction. Children sit at local (0,0)-relative
    // coords so the container's position defines the icon's center in world
    // space. No border — the progress outline is the only frame element.
    const boxGraphics = scene.add.graphics();
    boxGraphics.fillStyle(INTERACTION_ICON_BG_COLOR, 1);
    boxGraphics.fillRect(
      -half,
      -half,
      INTERACTION_ICON_SIZE_PX,
      INTERACTION_ICON_SIZE_PX,
    );

    // "E" letter centered. Rendered at 2× the final size (source font 14 px)
    // and scaled down 0.5× so the underlying canvas has enough resolution for
    // LINEAR filtering to anti-alias the glyph. Without forcing LINEAR here
    // the global pixelArt:true config nearest-samples the text texture and
    // the letter reads as jagged steps.
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

  setWorldPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  setAlpha(a: number): void {
    this.container.setAlpha(a);
  }

  setVisible(v: boolean): void {
    this.container.setVisible(v);
  }

  // ratio in [0, 1]. Clamped here for safety so callers don't have to.
  setProgress(ratio: number): void {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    // Always redraw the 0 and 1 endpoints so the outline lands cleanly at
    // "empty" or "full" rather than near them. Between those, dedupe small
    // deltas to skip the clear()+stroke() cycle on idle frames.
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

    // Square outline traced clockwise from top-center along the 4 edges of
    // a box that sits INTERACTION_ICON_PROGRESS_EDGE_OFFSET_PX outside the
    // icon's white background. The walk consumes `clamped * perimeter`
    // length, drawing whole segments until the remaining budget falls below
    // a segment's length, then drawing a partial segment for the final bit.
    const halfSide =
      INTERACTION_ICON_SIZE_PX / 2 + INTERACTION_ICON_PROGRESS_EDGE_OFFSET_PX;
    const side = halfSide * 2;
    const target = clamped * side * 4;

    // 5 segments because the walk starts and ends at top-center, so the top
    // edge is split into a starting half (top-center → top-right corner) and
    // a closing half (top-left corner → top-center). The middle three are
    // full edges.
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

  destroy(): void {
    // Container.destroy() recursively destroys its children, so the box,
    // text, and progress Graphics all go with it. No manual child cleanup
    // needed.
    this.container.destroy();
  }
}
