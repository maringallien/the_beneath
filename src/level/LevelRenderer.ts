import Phaser from 'phaser';
import {
  FOREGROUND_GLOW_ENABLED,
  FOREGROUND_GLOW_FLICKER_DURATION_MAX_MS,
  FOREGROUND_GLOW_FLICKER_DURATION_MIN_MS,
  FOREGROUND_GLOW_FLICKER_MAX_ALPHA,
  FOREGROUND_GLOW_FLICKER_MIN_ALPHA,
  FOREGROUND_GLOW_LAYER_PREFIX,
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

const FLIP_HORIZONTAL = 1;
const FLIP_VERTICAL = 2;

// Per-level mask is inflated by this many pixels on every side so adjacent
// levels' masks overlap at every shared edge — kills the 1-pixel seam where
// the scene clear color was bleeding through between two pixel-aligned but
// non-overlapping masks.
const MASK_OVERLAP_PX = 1;

// A rendered layer is either a baked RenderTexture (static tile layers — one
// draw call instead of one Image per tile) or a Container of live Images
// (animated layers: foreground glow, neon signs, decoration entities). Both
// expose the GameObject members the consumers touch — visible/setVisible
// (culling), depth (dim-overlay sandwiching), setMask/clearMask, destroy.
type RenderedDrawable =
  | Phaser.GameObjects.Container
  | Phaser.GameObjects.RenderTexture;

export interface RenderedLayer {
  identifier: string;
  type: LdtkLayerType;
  container: RenderedDrawable;
}

// Looping tweens that must keep running for the level's lifetime (foreground
// glow flicker). Collected per level so cullOffscreenLevels can pause them
// while the level is off-camera — otherwise every level's glow tweens tick
// every frame regardless of visibility. Sign flicker/pulsate tweens are
// intentionally NOT collected: there are only a handful of signs in the whole
// world, so their per-frame cost is noise and their self-rescheduling chains
// are awkward to pause cleanly.
export interface LevelAnimations {
  tweens: Phaser.Tweens.Tween[];
}

export interface RenderedLevel {
  widthPx: number;
  heightPx: number;
  layers: ReadonlyArray<RenderedLayer>;
  // Hidden Graphics that backs a per-level GeometryMask, applied to the
  // Image-based layers (glow, decoration entities) so any LDtk-authored
  // spillage past the level rect doesn't show in inter-level gaps. Baked
  // tile layers don't use it — their RenderTexture is level-sized, so it
  // clips spillage intrinsically. Null when a level has no Image layers.
  maskGraphics: Phaser.GameObjects.Graphics | null;
  // See LevelAnimations.
  animations: LevelAnimations;
}

// Renders each LDtk tile as an individual Image at its exact px position.
// Why not Phaser Tilemap: LDtk auto-rules can produce sub-grid placements
// (rule pivot offsets) and per-cell stacks (Stamp rules with multi-tile
// outputs). Tilemap is grid-locked and one-tile-per-cell, so it silently
// drops both. Image-per-tile preserves what the LDtk editor shows. Collision
// is handled separately by LevelCollision (IntGrid CSV → invisible tilemap),
// so visual fidelity here doesn't have to compromise with physics structure.
export function renderLevel(
  scene: Phaser.Scene,
  project: LdtkProject,
  level: LdtkLevel,
): RenderedLevel {
  const tilesetDefs = getTilesetDefs(project);
  const renderable = getRenderableLayers(level);
  const out: RenderedLayer[] = [];
  // Image-based containers (glow, decoration entities) that need the per-level
  // GeometryMask. Baked tile RenderTextures are omitted — they self-clip.
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

    // Bake the whole layer into ONE RenderTexture instead of one Image per
    // tile. A single level-layer is hundreds of tiles; across the handful of
    // levels visible while the camera scrolls that put tens of thousands of
    // Image GameObjects into the per-frame display-list walk — the dominant
    // frame-time cost (felt as choppiness once the camera moves). Baking
    // collapses each layer to a single draw call. Depth comes from the layer's
    // position in level.layerInstances so layers stack at the LDtk-authored
    // position; ties resolve by display-list insertion order (base, then the
    // brightness overlay, then glow — all created below in that order).
    const baseRt = bakeTileLayer(scene, level, src.tiles, textureKey);
    baseRt.setDepth(src.depth);
    out.push({ identifier: src.identifier, type: src.type, container: baseRt });

    // Per-layer brightness lift: for any layer whose identifier opts in via
    // LAYER_BRIGHTNESS_FACTORS, draw an ADD-blended sibling of each tile so
    // the layer reads (factor - 1) × 100% brighter without touching the
    // shared tileset texture. Used when a foreground layer shares its
    // tileset uid with the IntGrid ground and the two need to render at
    // different brightnesses (the per-tileset preload lift can't
    // differentiate them, since both pull from the same source pixels).
    const brightnessFactor = LAYER_BRIGHTNESS_FACTORS[src.identifier];
    if (brightnessFactor !== undefined && brightnessFactor > 1.0) {
      // Bake the same tiles into a second RenderTexture composited ADD-blended
      // at (factor - 1) alpha. For the normal one-tile-per-cell case this is
      // identical to the old per-tile ADD overlay: framebuffer += alpha ×
      // tileColor. Stacked overlay cells (Stamp rules emitting multiple tiles
      // into one cell) lose their double-add, an imperceptible difference on a
      // subtle brightness lift.
      const overlayAlpha = brightnessFactor - 1.0;
      const overlayRt = bakeTileLayer(scene, level, src.tiles, textureKey);
      overlayRt.setDepth(src.depth);
      overlayRt.setBlendMode(Phaser.BlendModes.ADD);
      overlayRt.setAlpha(overlayAlpha);
      out.push({
        identifier: src.identifier,
        type: src.type,
        container: overlayRt,
      });
    }

    // Glow pass: for any layer whose identifier opts into the effect, draw a
    // sibling glow image per tile from the pre-baked atlas with ADD blend.
    // The atlas only exists when GlowAtlasBaker found qualifying bright
    // pixels at preload, so textures.exists short-circuits this branch for
    // tilesets that don't contribute (e.g. a tileset used only on solid
    // ground tiles with no white dots). The glow container shares the base
    // layer's depth — Phaser falls back to display-list insertion order at
    // tied depths, so this container renders above the base. It's pushed
    // into `out` so the mask loop, cullOffscreenLevels, and
    // destroyRenderedLevel all process it uniformly.
    if (
      FOREGROUND_GLOW_ENABLED &&
      src.identifier.startsWith(FOREGROUND_GLOW_LAYER_PREFIX)
    ) {
      const glowKey = glowAtlasTextureKey(src.tilesetUid);
      if (scene.textures.exists(glowKey)) {
        // Skip frames whose source had no bright pixels — most foreground
        // tiles are stone/dirt with nothing to glow. Without this skip, the
        // glow container would carry one fully-transparent Image per such
        // tile and one wasted tween per Image, which scales linearly in the
        // foreground tile count.
        const brightFrames = getBrightFrames(glowKey);
        const glowContainer = scene.add.container(level.worldX, level.worldY);
        glowContainer.setDepth(src.depth);
        for (const t of src.tiles) {
          if (brightFrames && !brightFrames.has(t.t)) continue;
          const img = scene.add.image(t.px[0], t.px[1], glowKey, t.t);
          img.setOrigin(0, 0);
          img.setBlendMode(Phaser.BlendModes.ADD);
          if ((t.f & FLIP_HORIZONTAL) !== 0) img.setFlipX(true);
          if ((t.f & FLIP_VERTICAL) !== 0) img.setFlipY(true);
          glowContainer.add(img);
          // Per-image flicker (not per-container) so each glowing tile
          // pulses on its own schedule. With containers, all dots inside a
          // foreground layer flicker in lockstep — losing the candlelight
          // illusion. The per-image cost is bounded by the bright-frame
          // skip above; in practice only a small fraction of foreground
          // tiles carry bright pixels. The tween is collected so culling can
          // pause it while this level is off-camera.
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

  // Decoration entities (LDtk entities with embedded __tile references) live
  // in Entities-type layers and need their own rendering pass. Same Container-
  // per-layer + depth-by-layer-index scheme as the tile layers above, so the
  // user's LDtk-authored stacking between tile layers and decoration layers
  // is preserved.
  // Skip both the dynamically-spawned entities (rendered as live sprites by
  // gameplay code) and the General_enemy_spawn markers (editor-only spawn
  // sites with no in-game visual — and whose preview tile may reference a
  // tileset not present in this project, which would otherwise throw below).
  const entityLayers = getRenderableEntityLayers(
    level,
    new Set([...DYNAMIC_ENTITY_IDENTIFIERS, GENERAL_ENEMY_SPAWN_IDENTIFIER]),
  );
  for (const src of entityLayers) {
    const container = scene.add.container(level.worldX, level.worldY);
    container.setDepth(src.depth);
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
      // Lit decoration entities (neon signs, lit windows on houses) split
      // into two co-located images: a static "structure" image (frame, walls)
      // and a "lit" overlay (the colored letters/icons/dots) that receives
      // an animation tween. Both images share the source tile's position
      // and FitInside scaling, so visually they line up exactly as the
      // original tile would — the animation only affects the lit pixels.
      // The mode field on the config routes between abrupt sign flicker
      // and smooth house pulsate. Fallback: if the bake fails (source
      // texture not loaded yet, canvas context unavailable), render the
      // original tile so the decoration still appears, just unanimated.
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
          container.add(structureImg);
          container.add(litImg);
          if (litConfig.mode === 'flicker') {
            startSignFlicker(scene, litImg);
          } else {
            startSignPulsate(scene, litImg);
          }
          continue;
        }
      }
      const img = createEntityTileImage(scene, textureKey, dec);
      container.add(img);
    }
    maskTargets.push(container);
    out.push({ identifier: src.identifier, type: 'Entities', container });
  }

  // Build a rectangular world-space mask matching the level's bounds and apply
  // it to the Image-based layers (glow, decoration entities). scene.make.graphics()
  // (vs add) keeps the mask source off the display list — its geometry is
  // consumed by the GeometryMask without rendering on its own. Color choice
  // (white) is arbitrary; geometry masks ignore color and use only fill coverage.
  //
  // Baked tile layers are NOT masked: their RenderTexture is exactly the level
  // rect (inflated by MASK_OVERLAP_PX, with tiles offset to match), so it clips
  // spillage intrinsically and overlaps neighbors by 1px — the same anti-seam
  // behavior the mask gave the old per-tile Images, but for free.
  //
  // The mask rect is inflated by MASK_OVERLAP_PX on every side so adjacent
  // levels' masks overlap at every shared edge. Without this, seam pixels
  // can land in a sub-pixel zone where neither mask wins, letting the scene
  // clear color show through as a 1-pixel line. The cost is a 1-px ring of
  // tolerated spillage outside each level — invisible in practice.
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

// Bakes every tile of a layer into a single RenderTexture, replacing one Image
// per tile with one draw call per layer. The RT is sized to the level inflated
// by MASK_OVERLAP_PX on every side, with tiles offset to match, so it both
// clips spillage to (roughly) the level rect — replacing the per-layer
// GeometryMask the old per-tile path relied on — and overlaps adjacent levels'
// baked layers by 1px, killing the clear-color seam at shared edges.
//
// A single reusable stamp Image (never added to the display list) is mutated
// per tile and batch-drawn: batchGameObject renders it through its full render
// path, so frame, H/V flip, and origin are all honored. Stacked tiles in one
// cell paint bottom-to-top in autoLayerTiles order, matching LDtk's editor.
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
  // A DynamicTexture's render target is created LINEAR-filtered regardless of
  // the game's pixelArt config, so baked tiles would sample blurry at
  // CAMERA_ZOOM. Force NEAREST to match the crisp look of the source tileset
  // (which the old per-tile Images inherited from the loaded texture).
  rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

  const stamp = scene.make.image({ key: textureKey, add: false });
  stamp.setOrigin(0, 0);

  rt.beginDraw();
  for (const t of tiles) {
    // updateOrigin=false: setFrame would otherwise re-center the origin to the
    // frame pivot (0.5), undoing the top-left origin the tile placement needs.
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

// LDtk entity tiles use arbitrary src rects (tile.w/h can be larger than the
// tileset's tileGridSize). Phaser's spritesheet loader only produces fixed-
// size frames, so we register a custom-rect frame on the same texture for
// each unique entity-tile crop and reference it by name. Frames are cached
// across renders by their (uid + src rect) key — re-rendering after HMR
// reuses existing frames instead of duplicating them.
//
// Implements LDtk's tileRenderMode=FitInside: the source tile is scaled
// uniformly (preserving aspect ratio) to fit within the entity's bounding
// box, then anchored at the entity's pivot. Anchoring at the pivot — rather
// than centering the scaled tile inside the entity bounds — matters when
// pivot is non-centered: e.g. a ground prop with pivot=[0.5,1] and a tile
// taller-than-wide gets vertical letterbox; centering would make it float
// above the ground by half the letterbox height. Pivot-anchor keeps the
// pivot point on the ground regardless of aspect mismatch, which is what
// LDtk's editor shows. Every entity in this project uses FitInside; if that
// ever changes (Stretch, Cover, Repeat, etc.), this is the place to branch.
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
  return img;
}

export function findRenderedLayer(
  rendered: RenderedLevel,
  identifier: string,
): RenderedLayer | undefined {
  return rendered.layers.find((l) => l.identifier === identifier);
}

// Kicks off a yoyo'd alpha tween on a single glow Image so it breathes like
// candlelight on its own schedule. Each image draws a fresh random duration
// from [DURATION_MIN, DURATION_MAX] and a fresh random delay spanning two
// full cycles, then phase-shifts the playhead to a random point so its
// initial value doesn't snap to MIN_ALPHA when the delay expires. Combined,
// no two glow images share a phase or a period — neighboring dots flicker
// asynchronously across the entire world. Sine ease feels organic; Linear
// reads as a metronome. The tween targets the image directly, so when its
// parent container is destroyed (and the image with it via destroy(true)),
// Phaser's tween manager auto-prunes the tween on the next tick.
function startGlowFlicker(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Image,
  anims: LevelAnimations,
): void {
  const duration = Phaser.Math.Between(
    FOREGROUND_GLOW_FLICKER_DURATION_MIN_MS,
    FOREGROUND_GLOW_FLICKER_DURATION_MAX_MS,
  );
  // Initial alpha sampled across the flicker range so frame 0 already shows
  // a desynced cloud of brightnesses. Without this, every image would start
  // at MIN_ALPHA at world build and there'd be a visible "everything dim,
  // then ramps up over the first 1.5s" pattern as delays expire.
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
  // Seek by a normalized fraction of one full yoyo cycle so the playhead
  // lands at a random phase. Without this, every tween starts at its `from`
  // value (MIN_ALPHA) and the cycle progresses identically — the only
  // desync would come from different durations drifting apart over time.
  // Seeking shoves each image into its own corner of the cycle from frame 0.
  tween.seek(Math.random());
  // Collected so cullOffscreenLevels can pause this while the owning level is
  // off-camera — otherwise every glow tile in all 19 levels ticks every frame.
  anims.tweens.push(tween);
}

// Builds an Image for one of a sign's two baked textures (structure or lit).
// Mirrors createEntityTileImage's FitInside scaling and pivot anchoring so
// the two images render at the exact same on-screen rect as the original
// tile would — they line up pixel-for-pixel and only differ in which pixels
// each one contains. The baked texture is sized to (srcW, srcH) so no frame
// argument is needed.
function createSignLayerImage(
  scene: Phaser.Scene,
  textureKey: string,
  dec: RenderableEntityTile,
): Phaser.GameObjects.Image {
  const scale = Math.min(dec.entityW / dec.srcW, dec.entityH / dec.srcH);
  const img = scene.add.image(dec.px, dec.py, textureKey);
  img.setOrigin(dec.pivotX, dec.pivotY);
  img.setDisplaySize(dec.srcW * scale, dec.srcH * scale);
  return img;
}

// Drives a self-rescheduling tween chain on a sign's lit overlay so it reads
// as a buzzing, faulty neon light. Each cycle plays one "burst" — a sequence
// of BURST_SIZE rapid dim↔bright alpha pulses with independently-sampled
// per-pulse durations — followed by a hold at full brightness sampled from
// [INTERVAL_MIN, INTERVAL_MAX]. On completion, the next cycle is built with
// fresh random parameters, so no two cycles match and no two sign instances
// share a schedule. The chain targets the image directly; when its parent
// container is destroyed (and the image with it via destroy(true)), Phaser's
// tween manager auto-prunes the in-flight chain, so the onComplete handler
// stops firing without an explicit guard.
function startSignFlicker(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Image,
): void {
  const playCycle = (): void => {
    // Target's scene reference is nulled by GameObject.destroy(), so when
    // the level unloads (container.destroy(true) cascades to this image),
    // the delayedCall that triggers this callback may still fire one final
    // time before the time event is cleaned up. Bail here so we don't
    // schedule a tween chain on a dead target — that would infinite-loop
    // via the onComplete handler since the tween completes immediately
    // when its target has no live properties to animate.
    if (!target.scene) return;
    const burstSize = Phaser.Math.Between(
      SIGN_FLICKER_BURST_SIZE_MIN,
      SIGN_FLICKER_BURST_SIZE_MAX,
    );
    // Each burst is 2*burstSize tweens (bright→dim, dim→bright pairs) plus
    // one final hold-at-bright tween that fills the gap until the next
    // burst. Pre-allocating the array lets us hand the chain a fully-formed
    // tween list — Phaser plays them in order, then fires onComplete once
    // the last one finishes.
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
    // Idle period: alpha is already 1 from the final bright pulse above, so
    // animate to itself for a randomized duration — Phaser still respects
    // the duration even when from/to are equal, giving us a quiet hold
    // before the next burst.
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
  // Random initial delay (spanning one max interval) so multiple signs
  // don't all enter their first burst on the same frame. Once the cycles
  // start, the per-cycle randomization keeps them desynced indefinitely.
  scene.time.delayedCall(
    Phaser.Math.Between(0, SIGN_FLICKER_INTERVAL_MAX_MS),
    playCycle,
  );
}

// Drives a yoyo'd sine-eased alpha tween on a lit overlay so it reads as a
// slow breathing glow rather than a faulty light — the gentle alternative
// to startSignFlicker. MIN_ALPHA stays > 0 so the dot never fully blinks
// out — that's what distinguishes pulsate from flicker visually.
//
// Desync strategy: two-stage tween. Stage 1 ramps from a per-instance
// random starting alpha to a per-instance randomly-chosen endpoint (MIN or
// MAX), at a duration proportional to the remaining distance so the pulse
// speed stays even. Stage 2 starts the eternal yoyo from that endpoint to
// the opposite endpoint. Result: every house enters the loop at a different
// point in the cycle, including its initial direction — even if two houses
// happen to draw the same half-cycle duration, their phases differ. The
// alternative (tween.seek on a single yoyo) leaves houses built on the
// same frame visually in lockstep until their slightly-different periods
// drift apart, which can take minutes with sub-second cycles.
//
// Tweens target the image directly; when its parent container is destroyed
// (and the image with it via destroy(true)), Phaser's tween manager
// auto-prunes both stages on the next tick.
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
  // Duration of stage 1 = halfDuration * (remaining distance / full range).
  // Keeps the visual pulse rate consistent regardless of where we started.
  // Floor at 50ms so a near-endpoint start doesn't run a 0-duration tween
  // (Phaser would fire onComplete on the same frame, which is fine, but
  // 50ms gives the eye a moment to register the transition).
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
      // Image may have been destroyed during stage 1 if the level unloaded
      // mid-pulse. Bail without scheduling stage 2 — Phaser would otherwise
      // happily add a tween targeting a dead GameObject.
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

// Symmetric teardown for renderLevel. Container.destroy(true) recursively
// destroys child Images, which is safe here because tile Images have no
// physics bodies (renderLevel uses scene.add.image, not physics.add.image).
// Collision tilemaps are owned by GameScene/LevelCollision and torn down
// separately — they don't appear in RenderedLevel.layers.
export function destroyRenderedLevel(rendered: RenderedLevel): void {
  // Clear masks before destroying the backing Graphics — leaving a mask
  // pointing at a destroyed Graphics makes the next render frame throw.
  // clearMask(false) leaves the mask object itself for GC; we destroy the
  // shared source Graphics explicitly below.
  for (const layer of rendered.layers) {
    layer.container.clearMask(false);
    layer.container.destroy(true);
  }
  // Glow tweens are paused (not stepped) while their level is culled off-camera.
  // The Tween Manager only auto-prunes tweens it actively steps, so a paused
  // tween won't notice its target Image was destroyed above — remove explicitly
  // to avoid leaking it into the next world build on HMR/respawn.
  for (const tween of rendered.animations.tweens) {
    tween.remove();
  }
  rendered.maskGraphics?.destroy();
}
