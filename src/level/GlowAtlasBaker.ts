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

// Texture key for a tileset's sibling glow atlas. LevelRenderer reads from
// this key to decide whether to emit a glow image per tile, so the suffix
// scheme MUST stay in sync with bakeGlowAtlasForTileset.
export function glowAtlasTextureKey(tilesetUid: number): string {
  return tilesetTextureKey(tilesetUid) + FOREGROUND_GLOW_TEXTURE_SUFFIX;
}

// Per-atlas index of frames that contain at least one bright pixel. Populated
// by bakeGlowAtlasForTileset, consumed by LevelRenderer to skip emitting glow
// Images for tiles whose source frame would render fully transparent. Lives
// at module scope (not on the texture) so the bake step owns its own
// bookkeeping without touching Phaser internals; the cache survives HMR
// because the bake step itself is idempotent and re-uses cached glow textures
// when present.
const brightFrameSets = new Map<string, ReadonlySet<number>>();

export function getBrightFrames(
  glowKey: string,
): ReadonlySet<number> | undefined {
  return brightFrameSets.get(glowKey);
}

// One-shot pre-bake at preload. Reads the tileset's PNG, locates every pixel
// whose luminance exceeds FOREGROUND_GLOW_LUMINANCE_THRESHOLD, and paints a
// soft radial halo into a sibling canvas at the same position. Frame slicing
// mirrors the source tileset's frameWidth/frameHeight/margin/spacing exactly,
// so a foreground tile rendered with frame `t` from the source resolves to
// the matching glow frame `t` on the atlas.
//
// Returns true if any bright pixels were found (the atlas was registered);
// false if the tileset has no qualifying pixels (no atlas registered — the
// renderer short-circuits via textures.exists). Idempotent: a second call for
// the same uid no-ops once the glow texture is in cache.
export function bakeGlowAtlasForTileset(
  scene: Phaser.Scene,
  def: LdtkTilesetDef,
): boolean {
  const sourceKey = tilesetTextureKey(def.uid);
  const targetKey = glowAtlasTextureKey(def.uid);
  if (scene.textures.exists(targetKey)) return true;
  if (!scene.textures.exists(sourceKey)) return false;

  const sourceTexture = scene.textures.get(sourceKey);
  // getSourceImage returns whatever backed the load — <img> for PNGs through
  // Phaser's loader, <canvas> in some HMR paths. Both work with drawImage.
  const srcImg = sourceTexture.getSourceImage() as
    | HTMLImageElement
    | HTMLCanvasElement;
  const width = srcImg.width;
  const height = srcImg.height;
  if (width === 0 || height === 0) return false;

  // Read source pixels via an intermediate canvas. getImageData() requires a
  // 2D context and the original Image element doesn't expose pixel data.
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
  // Additive composition: overlapping halos accumulate, so a tight cluster
  // of bright pixels reads brighter than an isolated dot.
  outCtx.globalCompositeOperation = 'lighter';

  const radius = FOREGROUND_GLOW_RADIUS_PX;
  let bright = 0;

  // Frame-grid params for mapping a source pixel back to its frame index.
  // Mirrors the layout registerGlowFrames produces — so the set keyed by
  // frame index here is consumed verbatim by getBrightFrames at render time.
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

      // Record which frame the bright pixel lives inside. Pixels in the
      // margin/spacing gutters between frames don't belong to any frame —
      // skip them for the index but still paint the halo so the visual
      // bleed (rare, only near tileset edges) doesn't disappear.
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

  // LINEAR sampling so halos stay smooth at camera zoom — same trick used by
  // the magic orb and pause word textures. The global pixelArt:true config
  // would otherwise nearest-sample the soft gradient into hard banding.
  scene.textures
    .get(targetKey)
    .setFilter(Phaser.Textures.FilterMode.LINEAR);
  return true;
}

// Stamps a soft radial halo at (cx, cy) in the source pixel's color. Uses a
// radial gradient with stops sampled along the FALLOFF_EXPONENT curve; the
// gradient interpolates linearly between stops, which is visually
// indistinguishable from the exact curve at a halo of a few px.
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

// Adds per-tile frames to the glow texture so a numeric frame-index lookup
// resolves to the same source-tile crop the original spritesheet loader
// produced. Phaser's spritesheet loader keys frames by integer index in
// row-major order with margin + spacing exactly as configured — we mirror
// the same iteration so frame `t` on the source matches frame `t` on the
// glow atlas one-to-one.
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
  // Last frame fully fits when its right edge (margin + cols*(fw+spacing) - spacing)
  // is <= width. Solving for cols → floor((width - margin*2 + spacing) / (fw + spacing)).
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
