import Phaser from 'phaser';
import type { LdtkTilesetDef } from '../ldtk/types';
import { tilesetTextureKey } from './TilesetRegistry';

/**
 * @file level/TilesetBrightnessPass.ts
 * @description One-time preload pass that lifts a tileset texture's brightness IN PLACE (by key) so every consumer (render, glow, collision) reads brightened pixels; keeps the original key so nothing needs rewiring; idempotent across HMR (brightened keys recorded at module scope, never lifted twice).
 * @module level
 */

// Idempotency guard: keys already brightened are never lifted twice, even across HMR reloads.
const brightenedKeys = new Set<string>();

/**
 * @function    brightenTilesetTexture
 * @description Lifts every opaque pixel by factor, replaces the texture under the same key, and rebuilds the frame grid; no-ops on factor 1.0, an already-brightened key, a missing or zero-sized texture, or no 2D context.
 * @param   scene   Texture cache.
 * @param   def     LDtk tileset def: uid, grid size, padding, spacing.
 * @param   factor  Brightness multiplier; 1.0 is a no-op.
 * @calledby src/scenes/PreloadScene.ts → scene boot/preload flow, once the tileset images have loaded
 * @calls    the canvas 2D API for the pixel lift, the scene texture cache (remove/add), and the frame-grid re-registrar
 */
export function brightenTilesetTexture(
  scene: Phaser.Scene,
  def: LdtkTilesetDef,
  factor: number,
): void {
  if (factor === 1.0) return;
  const key = tilesetTextureKey(def.uid);
  if (brightenedKeys.has(key)) return;
  if (!scene.textures.exists(key)) return;

  const tex = scene.textures.get(key);
  const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const width = src.width;
  const height = src.height;
  if (width === 0 || height === 0) return;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(src, 0, 0);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i] * factor;
    const g = data[i + 1] * factor;
    const b = data[i + 2] * factor;
    data[i] = r > 255 ? 255 : Math.round(r);
    data[i + 1] = g > 255 ? 255 : Math.round(g);
    data[i + 2] = b > 255 ? 255 : Math.round(b);
  }
  ctx.putImageData(imageData, 0, 0);

  scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  registerSpritesheetFrames(scene, key, width, height, def);

  brightenedKeys.add(key);
}

/**
 * @function    registerSpritesheetFrames
 * @description Re-registers the spritesheet frame grid on the brightened canvas texture so frame-index lookups still work; adds one frame per fully-fitting tile cell in row-major order.
 * @param   scene   Texture cache.
 * @param   key     The brightened texture.
 * @param   width   Canvas px width.
 * @param   height  Canvas px height.
 * @param   def     Tileset def: grid size, padding, spacing.
 * @calledby src/level/TilesetBrightnessPass.ts → brightenTilesetTexture, right after the brightened canvas replaces the original
 * @calls    the texture's per-frame add API; pure grid arithmetic otherwise
 */
function registerSpritesheetFrames(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  def: LdtkTilesetDef,
): void {
  const texture = scene.textures.get(key);
  const fw = def.tileGridSize;
  const fh = def.tileGridSize;
  const margin = def.padding;
  const spacing = def.spacing;
  const cols = Math.max(
    0,
    Math.floor((width - margin * 2 + spacing) / (fw + spacing)),
  );
  const rows = Math.max(
    0,
    Math.floor((height - margin * 2 + spacing) / (fh + spacing)),
  );
  let frameIndex = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = margin + col * (fw + spacing);
      const y = margin + row * (fh + spacing);
      texture.add(frameIndex, 0, x, y, fw, fh);
      frameIndex++;
    }
  }
}
