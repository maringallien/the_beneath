import Phaser from 'phaser';
import type { LdtkTilesetDef } from '../ldtk/types';
import { tilesetTextureKey } from './TilesetRegistry';

// Idempotency guard. Once a tileset is brightened, we never touch it again —
// running the multiplier a second time would compound the lift and over-
// brighten the texture. Module scope persists across HMR within the same Vite
// session so successive scene reloads don't re-brighten an already-lifted
// texture.
const brightenedKeys = new Set<string>();

// Lifts every opaque pixel's RGB channels by `factor` (clamped to 255) in the
// tileset's underlying texture, then re-registers the spritesheet frame grid
// against the brightened canvas. Used at preload — before LevelRenderer or
// GlowAtlasBaker walk the texture — so downstream consumers transparently see
// the lifted pixels without any per-call adjustment.
//
// Phaser doesn't expose an in-place pixel mutator for image-backed textures,
// so we replace the texture: read the source into a canvas, transform, remove
// the original entry, then re-add as a canvas-backed texture under the same
// key and re-register the spritesheet frames. The texture key stays the same
// so every existing reference (LevelRenderer, GlowAtlasBaker, LevelCollision)
// keeps working without rewiring.
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

// Mirrors Phaser's spritesheet loader frame layout (row-major, fixed-size
// cells, configurable margin + spacing) so each integer frame index maps to
// the same crop the original loader produced. Without this, LevelRenderer's
// `scene.add.image(..., t.t)` (frame index lookup) would fail after the
// texture replacement — the canvas-backed texture has no frames by default.
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
