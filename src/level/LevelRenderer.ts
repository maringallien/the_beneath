import Phaser from 'phaser';
import {
  FOREGROUND_GLOW_ENABLED,
  FOREGROUND_GLOW_FLICKER_DURATION_MAX_MS,
  FOREGROUND_GLOW_FLICKER_DURATION_MIN_MS,
  FOREGROUND_GLOW_FLICKER_MAX_ALPHA,
  FOREGROUND_GLOW_FLICKER_MIN_ALPHA,
  FOREGROUND_GLOW_LAYER_PREFIX,
  FOREGROUND_OVERLAY_LAYER_DEPTHS,
  GENERAL_ENEMY_SPAWN_IDENTIFIER,
  LAYER_BRIGHTNESS_FACTORS,
  SIGN_FLICKER_BURST_SIZE_MAX,
  SIGN_FLICKER_BURST_SIZE_MIN,
  SIGN_FLICKER_DIM_ALPHA,
  SIGN_FLICKER_INTERVAL_MAX_MS,
  SIGN_FLICKER_INTERVAL_MIN_MS,
  SIGN_FLICKER_PULSE_DURATION_MAX_MS,
  SIGN_FLICKER_PULSE_DURATION_MIN_MS,
  SIGN_PULSATE_DURATION_MAX_MS,
  SIGN_PULSATE_DURATION_MIN_MS,
  SIGN_PULSATE_MAX_ALPHA,
  SIGN_PULSATE_MIN_ALPHA,
} from '../constants';
import { bakeSignTextures, getLitConfig } from './SignTextureBaker';
import { DYNAMIC_ENTITY_IDENTIFIERS } from '../entities/EntityFactory';
import {
  getEntityDefs,
  getRenderableEntityLayers,
  getRenderableLayers,
  getTilesetDefs,
  type RenderableEntityTile,
} from '../ldtk/parseLdtk';
import type {
  LdtkAutoLayerTile,
  LdtkLayerType,
  LdtkLevel,
  LdtkProject,
} from '../ldtk/types';
import { getBrightFrames, glowAtlasTextureKey } from './GlowAtlasBaker';
import { tilesetTextureKey } from './TilesetRegistry';

/**
 * LevelRenderer — turns one parsed LDtk level into the scene's visual layers.
 *
 * The tilemap/level rendering pipeline. Each renderable tile layer is baked
 * into a single RenderTexture (one draw call, not one Image per tile); animated
 * layers (foreground glow, neon/house signs, decoration entities) stay as
 * Containers of live Images so their tweens can run. Three concerns thread
 * through every layer: stacking (depth follows the LDtk-authored layer order,
 * but Foreground2/3 are lifted into an overlay band so they occlude dynamic
 * entities), brightness (per-layer ADD-blended sibling lifts via
 * LAYER_BRIGHTNESS_FACTORS), and spill containment (a per-level GeometryMask on
 * Image layers; baked RTs self-clip; out-of-bounds decorations are left
 * unmasked to bleed into the next level). Masks and RTs are inflated by
 * MASK_OVERLAP_PX so neighbours overlap and the inter-level seam can't show.
 * Collision is owned separately by LevelCollision, so nothing here is physical.
 *
 * Inputs:  the LDtk project + one level, the scene (textures must be preloaded),
 *          and the glow/sign/brightness tuning constants.
 * Outputs: a RenderedLevel (layers, mask Graphics, looping tweens) plus the
 *          GameObjects added to the scene; mutates nothing it doesn't own.
 * @calledby the level-streaming code, as each level enters the camera's reach,
 *           and torn down via destroyRenderedLevel when it leaves.
 * @calls    the tileset/glow-atlas registries, the sign-texture baker, and
 *           Phaser's RenderTexture / Container / mask / tween machinery.
 */

const FLIP_HORIZONTAL = 1;
const FLIP_VERTICAL = 2;

// Inflate each mask by this many px so adjacent levels' masks overlap and the clear-color seam disappears.
const MASK_OVERLAP_PX = 1;

// A baked RenderTexture (static tile layers) or a Container of live Images (animated layers: glow, signs, decorations).
type RenderedDrawable =
  | Phaser.GameObjects.Container
  | Phaser.GameObjects.RenderTexture;

export interface RenderedLayer {
  identifier: string;
  type: LdtkLayerType;
  container: RenderedDrawable;
}

// Looping glow-flicker tweens collected per level so culling can pause them off-camera.
// Sign tweens are intentionally excluded — too few to matter and awkward to pause cleanly.
export interface LevelAnimations {
  tweens: Phaser.Tweens.Tween[];
}

export interface RenderedLevel {
  widthPx: number;
  heightPx: number;
  layers: ReadonlyArray<RenderedLayer>;
  // Hidden Graphics backing the per-level GeometryMask for Image-based layers; null when no maskable layers exist.
  maskGraphics: Phaser.GameObjects.Graphics | null;
  // See LevelAnimations.
  animations: LevelAnimations;
}

// Renders one level: bakes tile layers, builds animated glow/sign/decoration layers, applies the spill mask, and returns the RenderedLevel handle.
export function renderLevel(
  scene: Phaser.Scene,
  project: LdtkProject,
  level: LdtkLevel,
): RenderedLevel {
  const tilesetDefs = getTilesetDefs(project);
  const renderable = getRenderableLayers(level);
  const out: RenderedLayer[] = [];
  // Image-based containers needing the per-level mask; baked RTs self-clip so they're excluded.
  const maskTargets: Phaser.GameObjects.Container[] = [];
  const animations: LevelAnimations = { tweens: [] };

  for (const src of renderable) {
    const tilesetDef = tilesetDefs.get(src.tilesetUid);
    if (!tilesetDef) {
      throw new Error(
        `Layer "${src.identifier}" references tileset uid=${src.tilesetUid}, which is not defined`,
      );
    }
    const textureKey = tilesetTextureKey(tilesetDef.uid);
    if (!scene.textures.exists(textureKey)) {
      throw new Error(
        `Tileset texture "${textureKey}" not loaded — was preloadTilesets() called for level "${level.identifier}"?`,
      );
    }

    // Depth from LDtk order, except Foreground2/3 are lifted to occlude dynamic entities.
    // Shared by base, brightness overlay, and glow sibling so all three are co-planar.
    const layerDepth =
      FOREGROUND_OVERLAY_LAYER_DEPTHS[src.identifier] ?? src.depth;
    const baseRt = bakeTileLayer(scene, level, src.tiles, textureKey);
    baseRt.setDepth(layerDepth);
    out.push({ identifier: src.identifier, type: src.type, container: baseRt });

    // Per-layer brightness lift: a second ADD-blended RT at (factor-1) alpha so a foreground
    // layer can be brighter than ground tiles sharing the same tileset texture.
    const brightnessFactor = LAYER_BRIGHTNESS_FACTORS[src.identifier];
    if (brightnessFactor !== undefined && brightnessFactor > 1.0) {
      const overlayAlpha = brightnessFactor - 1.0;
      const overlayRt = bakeTileLayer(scene, level, src.tiles, textureKey);
      overlayRt.setDepth(layerDepth);
      overlayRt.setBlendMode(Phaser.BlendModes.ADD);
      overlayRt.setAlpha(overlayAlpha);
      out.push({
        identifier: src.identifier,
        type: src.type,
        container: overlayRt,
      });
    }

    // Glow pass: for layers with the glow prefix, draw an ADD-blended sibling image per bright tile.
    if (
      FOREGROUND_GLOW_ENABLED &&
      src.identifier.startsWith(FOREGROUND_GLOW_LAYER_PREFIX)
    ) {
      const glowKey = glowAtlasTextureKey(src.tilesetUid);
      if (scene.textures.exists(glowKey)) {
        // Skip frames with no bright pixels to avoid transparent Images and wasted tweens.
        const brightFrames = getBrightFrames(glowKey);
        const glowContainer = scene.add.container(level.worldX, level.worldY);
        glowContainer.setDepth(layerDepth);
        for (const t of src.tiles) {
          if (brightFrames && !brightFrames.has(t.t)) continue;
          const img = scene.add.image(t.px[0], t.px[1], glowKey, t.t);
          img.setOrigin(0, 0);
          img.setBlendMode(Phaser.BlendModes.ADD);
          if ((t.f & FLIP_HORIZONTAL) !== 0) img.setFlipX(true);
          if ((t.f & FLIP_VERTICAL) !== 0) img.setFlipY(true);
          glowContainer.add(img);
          // Per-image tween so each tile pulses on its own schedule; collected for off-camera culling.
          startGlowFlicker(scene, img, animations);
        }
        maskTargets.push(glowContainer);
        out.push({
          identifier: src.identifier,
          type: src.type,
          container: glowContainer,
        });
      }
    }
  }

  // Decoration-entity pass: skips dynamic/spawn-marker entities, renders static __tile decorations per layer.
  const entityLayers = getRenderableEntityLayers(
    level,
    new Set([...DYNAMIC_ENTITY_IDENTIFIERS, GENERAL_ENEMY_SPAWN_IDENTIFIER]),
    getEntityDefs(project),
  );
  for (const src of entityLayers) {
    const container = scene.add.container(level.worldX, level.worldY);
    container.setDepth(src.depth);
    // Unmasked sibling for out-of-bounds decorations so they bleed into the adjacent level; created lazily.
    let oobContainer: Phaser.GameObjects.Container | null = null;
    for (const dec of src.decorations) {
      const tilesetDef = tilesetDefs.get(dec.tilesetUid);
      if (!tilesetDef) {
        throw new Error(
          `Layer "${src.identifier}" entity tile references tileset uid=${dec.tilesetUid}, which is not defined`,
        );
      }
      const textureKey = tilesetTextureKey(tilesetDef.uid);
      if (!scene.textures.exists(textureKey)) {
        throw new Error(
          `Tileset texture "${textureKey}" not loaded — was preloadTilesets() called for level "${level.identifier}"?`,
        );
      }
      // Out-of-bounds decorations go to the unmasked sibling; both containers share depth.
      let target = container;
      if (dec.allowOutOfBounds) {
        if (!oobContainer) {
          oobContainer = scene.add.container(level.worldX, level.worldY);
          oobContainer.setDepth(src.depth);
        }
        target = oobContainer;
      }
      // Lit decorations: split into a static "structure" image and an animated "lit" overlay.
      // Falls through to the plain tile if the bake fails.
      const litConfig = getLitConfig(dec.identifier);
      if (litConfig) {
        const signTextures = bakeSignTextures(
          scene,
          dec.tilesetUid,
          dec.srcX,
          dec.srcY,
          dec.srcW,
          dec.srcH,
          dec.identifier,
        );
        if (signTextures) {
          const structureImg = createSignLayerImage(
            scene,
            signTextures.structureKey,
            dec,
          );
          const litImg = createSignLayerImage(
            scene,
            signTextures.litKey,
            dec,
          );
          target.add(structureImg);
          target.add(litImg);
          if (litConfig.mode === 'flicker') {
            startSignFlicker(scene, litImg);
          } else {
            startSignPulsate(scene, litImg);
          }
          continue;
        }
      }
      const img = createEntityTileImage(scene, textureKey, dec);
      target.add(img);
    }
    // Drop the base container if empty (all entities were out-of-bounds); mask and keep it otherwise.
    if (container.length > 0) {
      maskTargets.push(container);
      out.push({ identifier: src.identifier, type: 'Entities', container });
    } else {
      container.destroy();
    }
    // The out-of-bounds container is rendered/culled/destroyed normally but never masked.
    if (oobContainer) {
      out.push({
        identifier: src.identifier,
        type: 'Entities',
        container: oobContainer,
      });
    }
  }

  // Rectangular GeometryMask over the level bounds for Image layers; inflated by MASK_OVERLAP_PX to kill the 1px seam between levels.
  let maskGraphics: Phaser.GameObjects.Graphics | null = null;
  if (maskTargets.length > 0) {
    maskGraphics = scene.make.graphics();
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(
      level.worldX - MASK_OVERLAP_PX,
      level.worldY - MASK_OVERLAP_PX,
      level.pxWid + MASK_OVERLAP_PX * 2,
      level.pxHei + MASK_OVERLAP_PX * 2,
    );
    const mask = maskGraphics.createGeometryMask();
    for (const container of maskTargets) {
      container.setMask(mask);
    }
  }

  return {
    widthPx: level.pxWid,
    heightPx: level.pxHei,
    layers: out,
    maskGraphics,
    animations,
  };
}

// Bakes all tiles of one layer into a single RenderTexture so the whole layer costs one draw call.
function bakeTileLayer(
  scene: Phaser.Scene,
  level: LdtkLevel,
  tiles: ReadonlyArray<LdtkAutoLayerTile>,
  textureKey: string,
): Phaser.GameObjects.RenderTexture {
  const rt = scene.add.renderTexture(
    level.worldX - MASK_OVERLAP_PX,
    level.worldY - MASK_OVERLAP_PX,
    level.pxWid + MASK_OVERLAP_PX * 2,
    level.pxHei + MASK_OVERLAP_PX * 2,
  );
  rt.setOrigin(0, 0);
  // Force NEAREST so baked tiles stay crisp — DynamicTexture defaults to LINEAR regardless of pixelArt config.
  rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

  const stamp = scene.make.image({ key: textureKey, add: false });
  stamp.setOrigin(0, 0);

  rt.beginDraw();
  for (const t of tiles) {
    // updateOrigin=false: prevents setFrame from re-centering the origin and breaking tile placement.
    stamp.setFrame(t.t, true, false);
    stamp.setFlip(
      (t.f & FLIP_HORIZONTAL) !== 0,
      (t.f & FLIP_VERTICAL) !== 0,
    );
    rt.batchDraw(stamp, t.px[0] + MASK_OVERLAP_PX, t.px[1] + MASK_OVERLAP_PX);
  }
  rt.endDraw();

  stamp.destroy();
  return rt;
}

// Builds a decoration Image: registers its custom-rect frame, applies FitInside scaling, and anchors at the LDtk pivot.
function createEntityTileImage(
  scene: Phaser.Scene,
  textureKey: string,
  dec: RenderableEntityTile,
): Phaser.GameObjects.Image {
  const frameName = `entityTile_${dec.srcX}_${dec.srcY}_${dec.srcW}_${dec.srcH}`;
  const texture = scene.textures.get(textureKey);
  if (!texture.has(frameName)) {
    texture.add(frameName, 0, dec.srcX, dec.srcY, dec.srcW, dec.srcH);
  }
  const scale = Math.min(dec.entityW / dec.srcW, dec.entityH / dec.srcH);
  const scaledW = dec.srcW * scale;
  const scaledH = dec.srcH * scale;
  const img = scene.add.image(dec.px, dec.py, textureKey, frameName);
  img.setOrigin(dec.pivotX, dec.pivotY);
  img.setDisplaySize(scaledW, scaledH);
  img.setAlpha(dec.alpha);
  return img;
}

// Looks up a rendered layer by its LDtk identifier, or undefined if absent.
export function findRenderedLayer(
  rendered: RenderedLevel,
  identifier: string,
): RenderedLayer | undefined {
  return rendered.layers.find((l) => l.identifier === identifier);
}

// Starts a random-phase, Sine-eased yoyo tween on one glow Image so each tile flickers on its own schedule.
function startGlowFlicker(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Image,
  anims: LevelAnimations,
): void {
  const duration = Phaser.Math.Between(
    FOREGROUND_GLOW_FLICKER_DURATION_MIN_MS,
    FOREGROUND_GLOW_FLICKER_DURATION_MAX_MS,
  );
  // Start at a random alpha so frame 0 is already desynced, not a uniform ramp-up.
  target.alpha = Phaser.Math.FloatBetween(
    FOREGROUND_GLOW_FLICKER_MIN_ALPHA,
    FOREGROUND_GLOW_FLICKER_MAX_ALPHA,
  );
  const tween = scene.tweens.add({
    targets: target,
    alpha: {
      from: FOREGROUND_GLOW_FLICKER_MIN_ALPHA,
      to: FOREGROUND_GLOW_FLICKER_MAX_ALPHA,
    },
    duration,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  // Seek to a random phase so tweens don't all start at MIN_ALPHA in lockstep.
  tween.seek(Math.random());
  // Collected so culling can pause it off-camera.
  anims.tweens.push(tween);
}

// Builds one of the two sign layer Images (structure or lit), matching createEntityTileImage's FitInside scaling and pivot.
function createSignLayerImage(
  scene: Phaser.Scene,
  textureKey: string,
  dec: RenderableEntityTile,
): Phaser.GameObjects.Image {
  const scale = Math.min(dec.entityW / dec.srcW, dec.entityH / dec.srcH);
  const img = scene.add.image(dec.px, dec.py, textureKey);
  img.setOrigin(dec.pivotX, dec.pivotY);
  img.setDisplaySize(dec.srcW * scale, dec.srcH * scale);
  img.setAlpha(dec.alpha);
  return img;
}

// Drives a self-rescheduling tween chain on a sign's lit overlay so it reads as a buzzing neon light.
function startSignFlicker(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Image,
): void {
  const playCycle = (): void => {
    // Guard against a delayedCall firing after the level unloads; chaining on a dead target would infinite-loop.
    if (!target.scene) return;
    const burstSize = Phaser.Math.Between(
      SIGN_FLICKER_BURST_SIZE_MIN,
      SIGN_FLICKER_BURST_SIZE_MAX,
    );
    // Build dim/bright pairs plus one hold-at-bright gap before the next burst.
    const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
    for (let i = 0; i < burstSize; i++) {
      tweens.push({
        targets: target,
        alpha: SIGN_FLICKER_DIM_ALPHA,
        duration: Phaser.Math.Between(
          SIGN_FLICKER_PULSE_DURATION_MIN_MS,
          SIGN_FLICKER_PULSE_DURATION_MAX_MS,
        ),
        ease: 'Linear',
      });
      tweens.push({
        targets: target,
        alpha: 1.0,
        duration: Phaser.Math.Between(
          SIGN_FLICKER_PULSE_DURATION_MIN_MS,
          SIGN_FLICKER_PULSE_DURATION_MAX_MS,
        ),
        ease: 'Linear',
      });
    }
    // Hold at 1 for a random duration between bursts (animate alpha→1 to self so Phaser respects the delay).
    tweens.push({
      targets: target,
      alpha: 1.0,
      duration: Phaser.Math.Between(
        SIGN_FLICKER_INTERVAL_MIN_MS,
        SIGN_FLICKER_INTERVAL_MAX_MS,
      ),
      ease: 'Linear',
    });
    scene.tweens.chain({
      targets: target,
      tweens,
      onComplete: playCycle,
    });
  };
  // Random initial delay so signs don't all start their first burst on the same frame.
  scene.time.delayedCall(
    Phaser.Math.Between(0, SIGN_FLICKER_INTERVAL_MAX_MS),
    playCycle,
  );
}

// Drives a slow breathing glow on a lit overlay: stage-1 ramps to a random phase, stage-2 is the eternal yoyo.
function startSignPulsate(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Image,
): void {
  const minA = SIGN_PULSATE_MIN_ALPHA;
  const maxA = SIGN_PULSATE_MAX_ALPHA;
  const halfDuration = Phaser.Math.Between(
    SIGN_PULSATE_DURATION_MIN_MS,
    SIGN_PULSATE_DURATION_MAX_MS,
  );
  const startAlpha = Phaser.Math.FloatBetween(minA, maxA);
  const goingUp = Math.random() < 0.5;
  const firstEndpoint = goingUp ? maxA : minA;
  const oppositeEndpoint = goingUp ? minA : maxA;
  const range = maxA - minA;
  // Scale stage-1 duration by remaining distance to keep the rate even; floor at 50ms to avoid a 0-duration flash.
  const firstDuration = Math.max(
    50,
    halfDuration * (Math.abs(firstEndpoint - startAlpha) / range),
  );
  target.alpha = startAlpha;
  scene.tweens.add({
    targets: target,
    alpha: firstEndpoint,
    duration: firstDuration,
    ease: 'Sine.easeInOut',
    onComplete: () => {
      // Bail if the level unloaded between stage-1 and stage-2.
      if (!target.scene) return;
      scene.tweens.add({
        targets: target,
        alpha: { from: firstEndpoint, to: oppositeEndpoint },
        duration: halfDuration,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    },
  });
}

// Tears down a rendered level: clears masks, destroys all layers and their children, and removes glow tweens.
export function destroyRenderedLevel(rendered: RenderedLevel): void {
  // Clear masks before destroying the backing Graphics; a dangling mask reference throws on the next frame.
  for (const layer of rendered.layers) {
    layer.container.clearMask(false);
    layer.container.destroy(true);
  }
  // Paused tweens aren't auto-pruned by the Tween Manager; remove explicitly to avoid leaking into the next world build.
  for (const tween of rendered.animations.tweens) {
    tween.remove();
  }
  rendered.maskGraphics?.destroy();
}
