import Phaser from 'phaser';
import { tilesetTextureKey } from './TilesetRegistry';

/**
 * SignTextureBaker — splits a lit-decoration tile into a static "structure" layer
 * and an animatable "lit" layer.
 *
 * For each registered decoration identifier, bakeSignTextures crops its source
 * tile and partitions every pixel by a per-identifier color filter: lit pixels
 * (the neon letters/window dots) into one texture, everything else into a sibling
 * "structure" texture. LevelRenderer then draws the structure at constant alpha
 * and the lit texture on top with a flicker/pulsate alpha, so the colored part
 * turns on/off without disturbing the static frame. Despite the "Sign" name (the
 * original use case), the registry covers any lit decoration — neon signs and the
 * teal house-window dots alike. Bakes are cached and shared across all instances
 * of an identifier.
 *
 * Inputs:  a scene (for its texture cache), a loaded tileset texture, a tile
 *          source rect, and the decoration identifier (selects the lit filter).
 * Outputs: two canvas textures registered in the scene cache; the LitConfig
 *          (filter + animation mode) consumed by the renderer.
 * @calledby the level renderer, when first rendering a lit decoration.
 * @calls    the canvas 2D context for pixel read/partition and the scene texture cache.
 */

type ColorFilter = (r: number, g: number, b: number, a: number) => boolean;

// Pixel filters for lit pixels. The blue filter accepts teal (the city tileset's neon is teal, not pure blue)
// while still excluding green-dominant aquas (b >= g) and warm mid-tones (b > r + 30).
const BLUE_LIT_FILTER: ColorFilter = (r, g, b, a) =>
  a > 0 && b > r + 30 && b >= g && b > 80;
const RED_LIT_FILTER: ColorFilter = (r, g, b, a) =>
  a > 0 && r > g + 30 && r > b + 30 && r > 80;

// Animation style for the lit overlay: 'flicker' for neon burst-style, 'pulsate' for slow house-window breathing.
export type LitMode = 'flicker' | 'pulsate';

interface LitConfig {
  readonly filter: ColorFilter;
  readonly mode: LitMode;
}

// Lit configs for all animated decorations; add an entry + filter here to wire up a new lit decoration.
const LIT_CONFIGS: Readonly<Record<string, LitConfig>> = {
  Sign1: { filter: BLUE_LIT_FILTER, mode: 'flicker' },
  Sign2: { filter: BLUE_LIT_FILTER, mode: 'flicker' },
  Sign3: { filter: RED_LIT_FILTER, mode: 'flicker' },
  House2: { filter: BLUE_LIT_FILTER, mode: 'pulsate' },
  House3: { filter: BLUE_LIT_FILTER, mode: 'pulsate' },
  House4: { filter: BLUE_LIT_FILTER, mode: 'pulsate' },
  House5: { filter: BLUE_LIT_FILTER, mode: 'pulsate' },
};

// Lit config (filter + animation mode) for an identifier, or null if it has none.
export function getLitConfig(identifier: string): LitConfig | null {
  return LIT_CONFIGS[identifier] ?? null;
}

export interface SignTextureKeys {
  structureKey: string;
  litKey: string;
}

// Bakes the structure/lit texture pair for one decoration; cached by identifier so all instances share one bake.
export function bakeSignTextures(
  scene: Phaser.Scene,
  tilesetUid: number,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  identifier: string,
): SignTextureKeys | null {
  const config = LIT_CONFIGS[identifier];
  if (!config) return null;
  const filter = config.filter;

  const structureKey = `signStructure_${identifier}`;
  const litKey = `signLit_${identifier}`;
  if (
    scene.textures.exists(structureKey) &&
    scene.textures.exists(litKey)
  ) {
    return { structureKey, litKey };
  }

  const sourceKey = tilesetTextureKey(tilesetUid);
  if (!scene.textures.exists(sourceKey)) return null;
  const sourceTexture = scene.textures.get(sourceKey);
  const srcImg = sourceTexture.getSourceImage() as
    | HTMLImageElement
    | HTMLCanvasElement;

  const readCanvas = document.createElement('canvas');
  readCanvas.width = srcW;
  readCanvas.height = srcH;
  const readCtx = readCanvas.getContext('2d');
  if (!readCtx) return null;
  // Crop the source rect so pixel indices align 1:1 with the output canvases.
  readCtx.drawImage(srcImg, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  const sourceData = readCtx.getImageData(0, 0, srcW, srcH);
  const src = sourceData.data;

  const structureCanvas = document.createElement('canvas');
  structureCanvas.width = srcW;
  structureCanvas.height = srcH;
  const structureCtx = structureCanvas.getContext('2d');

  const litCanvas = document.createElement('canvas');
  litCanvas.width = srcW;
  litCanvas.height = srcH;
  const litCtx = litCanvas.getContext('2d');

  if (!structureCtx || !litCtx) return null;

  const structureData = structureCtx.createImageData(srcW, srcH);
  const litData = litCtx.createImageData(srcW, srcH);

  // Partition each pixel into lit or structure; transparent pixels need no explicit copy (createImageData zeroes the buffer).
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    const a = src[i + 3];
    const target = filter(r, g, b, a) ? litData.data : structureData.data;
    target[i] = r;
    target[i + 1] = g;
    target[i + 2] = b;
    target[i + 3] = a;
  }

  structureCtx.putImageData(structureData, 0, 0);
  litCtx.putImageData(litData, 0, 0);

  if (!scene.textures.exists(structureKey)) {
    scene.textures.addCanvas(structureKey, structureCanvas);
  }
  if (!scene.textures.exists(litKey)) {
    scene.textures.addCanvas(litKey, litCanvas);
  }

  return { structureKey, litKey };
}
