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
 * @file level/GlowAtlasBaker.ts
 * @description One-shot pre-bake of a per-tileset "glow" texture giving bright foreground pixels a soft emissive halo; reads source PNG, finds pixels over FOREGROUND_GLOW_LUMINANCE_THRESHOLD, paints additive radial halos into a sibling canvas under a suffixed key; re-slices the SAME frame grid so glow frame t lines up with source frame t; records which frame indices actually contain a bright pixel (module scope) so the renderer skips empty frames; INVARIANT: suffix scheme + frame-grid math must stay in sync with the renderer.
 * @module level
 */

/** Texture key for a tileset's sibling glow atlas; suffix must stay in sync with the renderer. */
export function glowAtlasTextureKey(tilesetUid: number): string {
  return tilesetTextureKey(tilesetUid) + FOREGROUND_GLOW_TEXTURE_SUFFIX;
}

// Per-atlas set of frame indices containing a bright pixel; used by the renderer to skip empty glow tiles.
const brightFrameSets = new Map<string, ReadonlySet<number>>();

/** Frame indices that contain a bright pixel for this glow texture key (undefined if the tileset was never baked / had none). */
export function getBrightFrames(
  glowKey: string,
): ReadonlySet<number> | undefined {
  return brightFrameSets.get(glowKey);
}

/**
 * @function    bakeGlowAtlasForTileset
 * @description Bakes the glow atlas for one tileset: paints a radial halo per bright pixel into a sibling canvas texture; registers a LINEAR-filtered glow canvas, its frames, and the bright-frame index. Idempotent.
 * @param   scene  For its texture cache.
 * @param   def    LDtk tileset def: uid, grid size, padding, spacing.
 * @returns true if a glow texture now exists; false (no bake) when the source is missing, zero-sized, has no read context, or contains no bright pixels.
 * @calledby src/scenes/PreloadScene.ts → preload/level-setup pass, once per tileset before rendering
 * @calls    the Canvas 2D API for pixel reads and halo compositing, the halo painter and frame registrar, and the texture cache to register the result
 */
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

/**
 * @function    paintHalo
 * @description Stamps a soft radial halo at (cx, cy) using the source pixel's color and the falloff curve; fills one radial-gradient disc into the context.
 * @param   ctx     Output 2D context, additive blend.
 * @param   cx      Canvas px center X.
 * @param   cy      Canvas px center Y.
 * @param   radius  Halo px.
 * @param   r       Source pixel red (0-255).
 * @param   g       Source pixel green (0-255).
 * @param   b       Source pixel blue (0-255).
 * @calledby src/level/GlowAtlasBaker.ts → bakeGlowAtlasForTileset, once per bright source pixel
 * @calls    the Canvas 2D radial-gradient and arc-fill API
 */
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

/**
 * @function    registerGlowFrames
 * @description Registers per-tile frames on the glow texture in the same row-major order the spritesheet loader uses; adds one frame per fully-fitting tile cell so glow frame indices match source frame indices.
 * @param   scene       Texture cache.
 * @param   textureKey  The glow texture.
 * @param   width       Canvas px width.
 * @param   height      Canvas px height.
 * @param   def         Tileset def: grid size, padding, spacing.
 * @calledby src/level/GlowAtlasBaker.ts → bakeGlowAtlasForTileset, right after the glow canvas is registered
 * @calls    the texture's per-frame add API; pure grid arithmetic otherwise
 */
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
