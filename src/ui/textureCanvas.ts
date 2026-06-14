import Phaser from 'phaser';

/**
 * @file ui/textureCanvas.ts
 * @description Shared helper embedding a Phaser texture frame into the DOM as a <canvas> the browser scales via CSS, so overlays can render pixel-art (and procedural) game textures inside HTML.
 * @module ui
 */

/**
 * @function    drawTextureFrame
 * @description Draw a texture frame onto a canvas at native pixel size with smoothing off, resizing the canvas to match the frame.
 * @param   canvas      Target canvas to paint into.
 * @param   scene       Scene providing the texture cache.
 * @param   key         Texture key.
 * @param   frameIndex  Optional frame index/name; defaults to __BASE.
 * @returns true once painted, or false when the frame or 2D context is missing.
 * @calledby src/ui/textureCanvas.ts → frameCanvas (the only caller; itself widely used by the shop)
 * @calls    the scene's texture-frame lookup and the canvas 2D blit primitives
 */
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

/**
 * @function    frameCanvas
 * @description Allocate a fresh canvas and draw the given frame into it; use for static one-off icons.
 * @param   scene       Scene providing the texture cache.
 * @param   key         Texture key.
 * @param   frameIndex  Optional frame index/name.
 * @returns a new canvas with the frame drawn (blank if the draw failed).
 * @calledby src/ui/ShopOverlay.ts → buildItemIcon and buildCoinIcon
 * @calls    src/ui/textureCanvas.ts → drawTextureFrame
 */
export function frameCanvas(
  scene: Phaser.Scene,
  key: string,
  frameIndex?: number | string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  drawTextureFrame(canvas, scene, key, frameIndex);
  return canvas;
}
