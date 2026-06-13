import Phaser from 'phaser';
import {
  FOREGROUND_GLOW_CORE_ALPHA,
  FOREGROUND_GLOW_FALLOFF_EXPONENT,
  FOREGROUND_GLOW_LUMINANCE_THRESHOLD,
  FOREGROUND_GLOW_RADIUS_PX,
  FOREGROUND_GLOW_TEXTURE_SUFFIX,
} from '../constants';
import type { LdtkTilesetDef } from '../ldtk/types';
import { tilesetTextureKey } from './TilesetRegistry';

/**
 * GlowAtlasBaker — one-shot pre-bake of a per-tileset "glow" texture used to
 * give bright foreground pixels a soft emissive halo.
 *
 * At preload, for each tileset it reads the source PNG, finds every pixel whose
 * luminance clears FOREGROUND_GLOW_LUMINANCE_THRESHOLD, and paints an additive
 * radial halo at that position into a sibling canvas registered under a suffixed
 * texture key. The glow canvas matches the source dimensions and re-slices the
 * SAME frame grid (frameWidth/height/margin/spacing), so glow frame `t` lines up
 * one-to-one with source frame `t` — the renderer can request a glow image by the
 * same frame index. It also records which frame indices actually contain a bright
 * pixel, at module scope, so the renderer can skip frames that would bake empty.
 * INVARIANT: the texture-key suffix scheme and the frame-grid math here must stay
 * in sync with what the renderer assumes.
 *
 * Inputs:  the scene's texture cache and an LDtk tileset def (uid, grid, padding,
 *          spacing); reads the already-loaded source tileset image.
 * Outputs: a registered LINEAR-filtered glow canvas texture with per-tile frames,
 *          plus the module-scope bright-frame index; returns whether one was made.
 * @calledby the preload/level-setup pass, once per tileset before rendering.
 * @calls    the Canvas 2D API for pixel reads and halo compositing, and Phaser's
 *           texture cache to register the result.
 */

// Texture key for a tileset's sibling glow atlas; suffix must stay in sync with the renderer.
export function glowAtlasTextureKey(tilesetUid: number): string {
  return tilesetTextureKey(tilesetUid) + FOREGROUND_GLOW_TEXTURE_SUFFIX;
}

// Per-atlas set of frame indices containing a bright pixel; used by the renderer to skip empty glow tiles.
const brightFrameSets = new Map<string, ReadonlySet<number>>();

// Frame indices that contain a bright pixel for this glow texture key (undefined
// if the tileset was never baked / had none).
export function getBrightFrames(
  glowKey: string,
): ReadonlySet<number> | undefined {
  return brightFrameSets.get(glowKey);
}

// Bakes the glow atlas for one tileset: paints a radial halo per bright pixel into a sibling canvas texture. Idempotent.
export function bakeGlowAtlasForTileset(
  scene: Phaser.Scene,
  def: LdtkTilesetDef,
): boolean {
  const sourceKey = tilesetTextureKey(def.uid);
  const targetKey = glowAtlasTextureKey(def.uid);
  if (scene.textures.exists(targetKey)) return true;
  if (!scene.textures.exists(sourceKey)) return false;

  const sourceTexture = scene.textures.get(sourceKey);
  const srcImg = sourceTexture.getSourceImage() as
    | HTMLImageElement
    | HTMLCanvasElement;
  const width = srcImg.width;
  const height = srcImg.height;
  if (width === 0 || height === 0) return false;

  // Read pixels via a canvas; getImageData() requires a 2D context the original Image doesn't expose.
  const readCanvas = document.createElement('canvas');
  readCanvas.width = width;
  readCanvas.height = height;
  const readCtx = readCanvas.getContext('2d');
  if (!readCtx) return false;
  readCtx.drawImage(srcImg, 0, 0);
  const imageData = readCtx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Output canvas matches source dimensions so frame coords map 1:1.
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return false;
  // Additive composition: overlapping halos accumulate so dense clusters glow brighter.
  outCtx.globalCompositeOperation = 'lighter';

  const radius = FOREGROUND_GLOW_RADIUS_PX;
  let bright = 0;

  // Frame-grid math mirrors registerGlowFrames so the bright-frame index lines up at render time.
  const fw = def.tileGridSize;
  const fh = def.tileGridSize;
  const margin = def.padding;
  const spacing = def.spacing;
  const colWithSpacing = fw + spacing;
  const rowWithSpacing = fh + spacing;
  const cols = Math.max(
    0,
    Math.floor((width - margin * 2 + spacing) / colWithSpacing),
  );
  const brightFrames = new Set<number>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (luminance < FOREGROUND_GLOW_LUMINANCE_THRESHOLD) continue;

      // Record the frame index for this pixel; gutter pixels are skipped for the index but still get a halo.
      const xRel = x - margin;
      const yRel = y - margin;
      if (xRel >= 0 && yRel >= 0) {
        const col = Math.floor(xRel / colWithSpacing);
        const row = Math.floor(yRel / rowWithSpacing);
        const colOffset = xRel - col * colWithSpacing;
        const rowOffset = yRel - row * rowWithSpacing;
        if (colOffset < fw && rowOffset < fh && col < cols) {
          brightFrames.add(row * cols + col);
        }
      }

      paintHalo(outCtx, x + 0.5, y + 0.5, radius, r, g, b);
      bright++;
    }
  }

  if (bright === 0) return false;

  scene.textures.addCanvas(targetKey, outCanvas);
  registerGlowFrames(scene, targetKey, width, height, def);
  brightFrameSets.set(targetKey, brightFrames);

  // LINEAR so halos stay smooth at camera zoom; pixelArt:true would nearest-sample the gradient into banding.
  scene.textures
    .get(targetKey)
    .setFilter(Phaser.Textures.FilterMode.LINEAR);
  return true;
}

// Stamps a soft radial halo at (cx, cy) using the source pixel's color and the falloff curve.
function paintHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  r: number,
  g: number,
  b: number,
): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  const STOPS = 6;
  for (let i = 0; i <= STOPS; i++) {
    const t = i / STOPS;
    const falloff = Math.pow(1 - t, FOREGROUND_GLOW_FALLOFF_EXPONENT);
    const alpha = FOREGROUND_GLOW_CORE_ALPHA * falloff;
    gradient.addColorStop(t, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  }
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

// Registers per-tile frames on the glow texture in the same row-major order the spritesheet loader uses.
function registerGlowFrames(
  scene: Phaser.Scene,
  textureKey: string,
  width: number,
  height: number,
  def: LdtkTilesetDef,
): void {
  const texture = scene.textures.get(textureKey);
  const fw = def.tileGridSize;
  const fh = def.tileGridSize;
  const margin = def.padding;
  const spacing = def.spacing;
  // Only register fully-fitting frames: floor((width - margin*2 + spacing) / (fw + spacing)).
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
