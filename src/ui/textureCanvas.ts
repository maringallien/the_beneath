import Phaser from 'phaser';

/**
 * textureCanvas — embeds Phaser texture frames into the DOM as <canvas>.
 *
 * Shared helper letting the merchant shop and the player HUD render pixel-art
 * (and procedural) game textures inside HTML by drawing a single frame onto an
 * HTMLCanvasElement the browser scales via CSS. Kept here so the two overlays
 * share one implementation rather than each carrying a private copy.
 *
 * Inputs:  a Phaser scene (for its texture cache), a texture key, and an
 *          optional frame index/name.
 * Outputs: draws onto a canvas (or returns a freshly allocated one).
 * @calledby the DOM overlays that show game textures as HTML — shop icons and
 *           the HUD's icons/sliders.
 * @calls    the scene's texture cache and the canvas 2D drawing API.
 */

// Draws a texture frame onto a canvas at native pixel size with smoothing off; resizes the canvas to match the frame.
export function drawTextureFrame(
  canvas: HTMLCanvasElement,
  scene: Phaser.Scene,
  key: string,
  frameIndex?: number | string,
): boolean {
  const frameId = frameIndex === undefined ? '__BASE' : frameIndex;
  const frame = scene.textures.getFrame(key, frameId);
  if (!frame) return false;

  const source = frame.source.image as CanvasImageSource;
  if (canvas.width !== frame.cutWidth) canvas.width = frame.cutWidth;
  if (canvas.height !== frame.cutHeight) canvas.height = frame.cutHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    source,
    frame.cutX,
    frame.cutY,
    frame.cutWidth,
    frame.cutHeight,
    0,
    0,
    frame.cutWidth,
    frame.cutHeight,
  );
  return true;
}

// Allocates a fresh canvas and draws the given frame into it; use for static one-off icons.
export function frameCanvas(
  scene: Phaser.Scene,
  key: string,
  frameIndex?: number | string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  drawTextureFrame(canvas, scene, key, frameIndex);
  return canvas;
}
