import Phaser from 'phaser';

// Shared helper for embedding Phaser texture frames in the DOM. The merchant
// shop and the player HUD both render pixel-art (and procedural) game textures
// inside HTML by drawing a single frame onto an HTMLCanvasElement the browser
// can scale via CSS. Kept here so the two overlays share one implementation
// rather than each carrying a private copy.

// Draws the given texture frame onto `canvas` at the frame's native pixel size,
// with image smoothing disabled so pixel-art sources stay crisp. The canvas
// backing store is (re)sized to the frame, so the same canvas can be redrawn
// with a different frame later (e.g. the HP slider swapping fill levels)
// without allocating a new element. CSS width/height on the canvas drives the
// on-screen scaling. Returns false if the frame or 2D context is unavailable.
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

// Convenience wrapper: allocate a fresh canvas sized to the frame and draw it.
// Used where the texture is static for the element's lifetime (shop item
// icons, the ammo/coin/heart HUD icons).
export function frameCanvas(
  scene: Phaser.Scene,
  key: string,
  frameIndex?: number | string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  drawTextureFrame(canvas, scene, key, frameIndex);
  return canvas;
}
