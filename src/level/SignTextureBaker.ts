import Phaser from 'phaser';
import { tilesetTextureKey } from './TilesetRegistry';

type ColorFilter = (r: number, g: number, b: number, a: number) => boolean;

// Pixel-level filters identifying which pixels of each sign tile are "lit"
// (the neon-colored letters/icons). Pixels failing the filter are considered
// "structure" (frame, background, mounting hardware) and stay rendered at
// constant alpha. The blue filter accepts cyan/teal as well as pure blue —
// the city tileset's neon highlight is actually teal RGB(126,191,198), where
// G and B are nearly equal — so requiring b > g + N would reject it. We
// still require b >= g so green-dominant aquas don't sneak in, plus b > r + 30
// to keep grays and warm mid-tones out of the lit set.
const BLUE_LIT_FILTER: ColorFilter = (r, g, b, a) =>
  a > 0 && b > r + 30 && b >= g && b > 80;
const RED_LIT_FILTER: ColorFilter = (r, g, b, a) =>
  a > 0 && r > g + 30 && r > b + 30 && r > 80;

// Animation style for a lit decoration's overlay. 'flicker' is the abrupt
// burst-style on/off tween used by neon signs (see SIGN_FLICKER_* constants
// + startSignFlicker). 'pulsate' is a smooth sine-eased yoyo between dim
// and bright, used for the slow breathing house-window dots (see
// SIGN_PULSATE_* constants + startSignPulsate). LevelRenderer routes on
// this field after baking the structure/lit pair.
export type LitMode = 'flicker' | 'pulsate';

interface LitConfig {
  readonly filter: ColorFilter;
  readonly mode: LitMode;
}

// Per-identifier lit config. Despite the "SIGN" name on this file (kept
// from the original use case), this map covers any decoration entity with
// a lit element — neon signs flicker abruptly, the small teal window dots
// on House2..House5 pulsate slowly. Adding a new lit decoration is one
// entry plus, if its lit color differs, a matching filter constant above.
// The presence of an identifier in this map is what LevelRenderer keys on
// to enable the structure-plus-lit rendering branch — see getLitConfig.
const LIT_CONFIGS: Readonly<Record<string, LitConfig>> = {
  Sign1: { filter: BLUE_LIT_FILTER, mode: 'flicker' },
  Sign2: { filter: BLUE_LIT_FILTER, mode: 'flicker' },
  Sign3: { filter: RED_LIT_FILTER, mode: 'flicker' },
  House2: { filter: BLUE_LIT_FILTER, mode: 'pulsate' },
  House3: { filter: BLUE_LIT_FILTER, mode: 'pulsate' },
  House4: { filter: BLUE_LIT_FILTER, mode: 'pulsate' },
  House5: { filter: BLUE_LIT_FILTER, mode: 'pulsate' },
};

export function getLitConfig(identifier: string): LitConfig | null {
  return LIT_CONFIGS[identifier] ?? null;
}

export interface SignTextureKeys {
  structureKey: string;
  litKey: string;
}

// Bakes two sibling textures from a sign's source tile rect: one containing
// only "structure" pixels (transparent where the lit pixels were) and one
// containing only "lit" pixels. LevelRenderer composes them by drawing the
// structure at constant alpha and the lit texture on top with a flickering
// alpha, so the colored portion can turn on/off without affecting the static
// sign frame.
//
// Cached by identifier — all instances of Sign1 share one structure/lit pair,
// so a level with N signs of the same identifier still costs a single bake.
// Returns null if the identifier has no filter, the source texture isn't
// loaded, or the canvas context couldn't be acquired (offscreen/headless
// environments). Idempotent: repeat calls return the existing keys without
// re-baking.
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
  // getSourceImage returns whatever backed the load — <img> for PNGs through
  // Phaser's loader, <canvas> in some HMR paths. Both are valid drawImage
  // sources.
  const srcImg = sourceTexture.getSourceImage() as
    | HTMLImageElement
    | HTMLCanvasElement;

  const readCanvas = document.createElement('canvas');
  readCanvas.width = srcW;
  readCanvas.height = srcH;
  const readCtx = readCanvas.getContext('2d');
  if (!readCtx) return null;
  // Source-rect crop into a srcW×srcH canvas so pixel indices below align
  // 1:1 with output canvas coordinates regardless of the tile's position
  // within the parent tileset.
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

  // Partition every source pixel into exactly one of the two outputs. Pixels
  // matching the filter land in the lit canvas; everything else (including
  // fully-transparent source pixels) lands in the structure canvas — but
  // createImageData's default is transparent black, so transparent source
  // pixels stay transparent in both outputs without an explicit copy.
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
