import Phaser from 'phaser';
import type { LdtkTilesetDef } from '../ldtk/types';
import { tilesetTextureKey } from './TilesetRegistry';

/**
 * TilesetBrightnessPass — a one-time preload pass that lifts a tileset texture's
 * brightness in place (by key) so the whole game reads the brightened pixels.
 *
 * Mutates the loaded tileset texture before any consumer walks it (level render,
 * glow baking, collision), keeping the original texture key so no reference
 * needs rewiring. Idempotent across HMR reloads: a brightened key is recorded
 * at module scope and never lifted twice.
 *
 * Inputs:  the scene's texture cache, an LDtk tileset def, a brightness factor.
 * Outputs: replaces the keyed texture with a brightened canvas-backed one and
 *          re-registers its spritesheet frame grid; no return.
 * @calledby the scene boot/preload flow, once the tileset images have loaded.
 * @calls    the scene's texture cache (read/remove/add) and the canvas 2D API.
 */

// Idempotency guard: keys already brightened are never lifted twice, even across HMR reloads.
const brightenedKeys = new Set<string>();

// Lifts every opaque pixel by factor, replaces the texture under the same key, and rebuilds the frame grid.
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

// Re-registers the spritesheet frame grid on the brightened canvas texture so frame-index lookups still work.
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
