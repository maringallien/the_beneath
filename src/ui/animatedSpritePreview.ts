import Phaser from 'phaser';
import { getAnimationFrameInfo } from '../sprites/characterLoader';

// Animated spritesheet preview rendered into a standalone DOM <canvas>, used by
// the "How to Play" manual's Combat tab to loop the player's sword / magic / gun
// attacks.
//
// Why this exists instead of a Phaser sprite: the pause menu calls
// anims.pauseAll(), so any Phaser-driven animation is frozen while the manual is
// open. This widget owns its own requestAnimationFrame loop and draws frames
// straight from the already-loaded spritesheet textures, so it keeps animating
// regardless of the global AnimationManager state. It also never touches the
// Phaser display list — purely a DOM element the overlay positions with CSS.
//
// Frame layout (size, count, anchor, displayScale) is read from the sprite
// registry via getAnimationFrameInfo so a preview can never drift from how the
// frame is drawn in-game.

// Places a layer on top of a clip's BASE layer rather than on the shared ground
// baseline — used for the gun overlay, which rides on the gunslinger body at a
// fixed grip offset (mirrors PlayerGun.syncToOwner).
export interface PreviewAttach {
  // Offset, in the base layer's SOURCE pixels, from the base sprite's origin
  // point (its display origin: anchorX horizontally, vertical centre) to this
  // layer's pivot. Multiplied by `scale` at draw time. (= GUN_OVERLAY_PIVOT_*.)
  readonly offsetX: number;
  readonly offsetY: number;
  // This layer's own pivot, as a fraction of its frame (e.g. the gun grip).
  readonly originX: number;
  readonly originY: number;
  // Scale this layer (and the offset) is drawn at — the owner/body scale.
  readonly scale: number;
  // Optional fixed rotation in radians (default 0 → barrel points right).
  readonly rotation?: number;
}

export interface PreviewLayerSpec {
  // Phaser texture key (identical to the animation full key, e.g.
  // 'sword_master_attack1' or 'gun1_overlay_attack1').
  readonly textureKey: string;
  // Frames to show, in order. Defaults to every frame (0 … frameCount-1).
  readonly frameOrder?: ReadonlyArray<number>;
  // When present, this layer is attached to the clip's base layer. When absent,
  // the layer is the base: ground-anchored by its JSON anchor so its feet sit on
  // the shared baseline. The FIRST layer of a clip must be a base (no attach).
  readonly attach?: PreviewAttach;
}

export interface PreviewClipSpec {
  // Drawn back-to-front; layer 0 is the base. A single-layer clip is one swing
  // of a combo; a two-layer clip is body + gun overlay.
  readonly layers: ReadonlyArray<PreviewLayerSpec>;
  // Extra ticks to hold the clip's last frame before advancing — a beat between
  // combo swings or between gun shots. Defaults to 0.
  readonly holdFrames?: number;
}

export interface AnimatedSpritePreviewOptions {
  readonly scene: Phaser.Scene;
  // Clips played in order, then looped. Sword/magic pass one clip per combo
  // step; guns pass an idle beat + a fire clip.
  readonly clips: ReadonlyArray<PreviewClipSpec>;
  // Playback rate. Defaults to the character animation rate (12 fps).
  readonly fps?: number;
  // Fit the whole animation (all clips/frames) inside this box, in CSS px,
  // preserving aspect with the figure's feet on the bottom. Wide swing frames
  // are bounded by width, tall spell frames by height — so every preview stays
  // within its stage regardless of the sheet's native proportions.
  readonly maxWidthPx: number;
  readonly maxHeightPx: number;
}

const DEFAULT_FPS = 12;
// Padding (source px, pre-fit) around the union bounds so anti-aliased edges and
// wide swing frames never clip against the canvas border.
const BOUNDS_PADDING = 2;

// One resolved layer occurrence within a clip: the source image, per-frame cut
// rects, and the draw geometry (all in display units relative to the baseline
// ground point, before the final fit scale is applied).
interface LayerDescriptor {
  readonly image: CanvasImageSource;
  readonly cutRects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly scale: number; // display-unit scale (displayScale or body scale)
  readonly originPxX: number; // pivot within the frame, in source px
  readonly originPxY: number;
  readonly pivotX: number; // pivot position in display units, from ground point
  readonly pivotY: number;
  readonly rotation: number;
}

// A single rendered tick: which absolute frame each layer shows.
interface SequenceStep {
  readonly draws: ReadonlyArray<{ layer: LayerDescriptor; frameIndex: number }>;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class AnimatedSpritePreview {
  readonly el: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly fps: number;
  private readonly sequence: ReadonlyArray<SequenceStep>;
  private readonly available: boolean;

  // Backing-store transform from display units to device pixels.
  private readonly fitScale: number;
  private readonly groundX: number;
  private readonly groundY: number;

  private rafId: number | null = null;
  private accumulatorMs = 0;
  private lastTimeMs = 0;
  private stepIndex = 0;

  constructor(options: AnimatedSpritePreviewOptions) {
    this.fps = options.fps ?? DEFAULT_FPS;

    const canvas = document.createElement('canvas');
    canvas.className = 'manual-sprite-preview';
    this.el = canvas;
    this.ctx = canvas.getContext('2d');

    const built = buildDescriptors(options.scene, options.clips);
    this.available = built.available;
    this.sequence = built.sequence;

    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    const unionW = Math.max(1, built.bounds.maxX - built.bounds.minX);
    const unionH = Math.max(1, built.bounds.maxY - built.bounds.minY);

    // Contain the union bounds within the box: device-px-per-display-unit is
    // bounded by whichever axis is tighter, so nothing overflows or is squashed.
    // The backing store is at device resolution (dpr-aware) and CSS sizes it back
    // down, so the crisp nearest-neighbour upscale survives onto HiDPI screens.
    this.fitScale = Math.min(
      (options.maxWidthPx * dpr) / unionW,
      (options.maxHeightPx * dpr) / unionH,
    );
    canvas.width = Math.max(1, Math.round(unionW * this.fitScale));
    canvas.height = Math.max(1, Math.round(unionH * this.fitScale));
    canvas.style.width = `${Math.round(canvas.width / dpr)}px`;
    canvas.style.height = `${Math.round(canvas.height / dpr)}px`;

    // Ground point (where every layer's baseline anchor maps) in backing-store px.
    this.groundX = -built.bounds.minX * this.fitScale;
    this.groundY = -built.bounds.minY * this.fitScale;

    this.renderStep(0);
  }

  // True when every referenced texture was loaded. When false the canvas is
  // blank and the caller should show a fallback instead.
  isAvailable(): boolean {
    return this.available;
  }

  start(): void {
    if (this.rafId !== null || !this.available || this.sequence.length <= 1) {
      // Nothing to animate (missing textures, or a single static frame): the
      // constructor already drew the first frame.
      return;
    }
    this.lastTimeMs = performance.now();
    this.accumulatorMs = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  destroy(): void {
    this.stop();
    this.el.remove();
  }

  private readonly tick = (now: number): void => {
    const frameMs = 1000 / this.fps;
    this.accumulatorMs += now - this.lastTimeMs;
    this.lastTimeMs = now;
    // Guard against tab-switch / breakpoint gaps producing a huge catch-up burst.
    if (this.accumulatorMs > frameMs * 4) this.accumulatorMs = frameMs;

    let advanced = false;
    while (this.accumulatorMs >= frameMs) {
      this.accumulatorMs -= frameMs;
      this.stepIndex = (this.stepIndex + 1) % this.sequence.length;
      advanced = true;
    }
    if (advanced) this.renderStep(this.stepIndex);

    this.rafId = requestAnimationFrame(this.tick);
  };

  private renderStep(index: number): void {
    if (!this.ctx) return;
    const step = this.sequence[index];
    this.ctx.clearRect(0, 0, this.el.width, this.el.height);
    if (!step) return;
    this.ctx.imageSmoothingEnabled = false;
    for (const { layer, frameIndex } of step.draws) {
      this.drawLayerFrame(this.ctx, layer, frameIndex);
    }
  }

  private drawLayerFrame(
    ctx: CanvasRenderingContext2D,
    layer: LayerDescriptor,
    frameIndex: number,
  ): void {
    const cut = layer.cutRects[frameIndex];
    if (!cut) return;
    const s = layer.scale * this.fitScale;
    const pivotX = this.groundX + layer.pivotX * this.fitScale;
    const pivotY = this.groundY + layer.pivotY * this.fitScale;

    ctx.save();
    ctx.translate(pivotX, pivotY);
    if (layer.rotation) ctx.rotate(layer.rotation);
    ctx.drawImage(
      layer.image,
      cut.x,
      cut.y,
      cut.w,
      cut.h,
      -layer.originPxX * s,
      -layer.originPxY * s,
      layer.frameWidth * s,
      layer.frameHeight * s,
    );
    ctx.restore();
  }
}

// Resolves every clip's layers into draw descriptors, the looping render
// sequence, and the union bounds (display units, relative to the ground point).
// Returns available:false if any referenced texture is missing.
function buildDescriptors(
  scene: Phaser.Scene,
  clips: ReadonlyArray<PreviewClipSpec>,
): {
  available: boolean;
  sequence: ReadonlyArray<SequenceStep>;
  bounds: Bounds;
} {
  const bounds: Bounds = {
    minX: -BOUNDS_PADDING,
    maxX: BOUNDS_PADDING,
    minY: -BOUNDS_PADDING,
    maxY: BOUNDS_PADDING,
  };
  const sequence: SequenceStep[] = [];
  let available = true;

  for (const clip of clips) {
    const descriptors: LayerDescriptor[] = [];
    let base: LayerDescriptor | null = null;

    for (const spec of clip.layers) {
      const resolved = resolveLayer(scene, spec, base);
      if (!resolved) {
        available = false;
        continue;
      }
      if (!base) base = resolved;
      descriptors.push(resolved);
      growBounds(bounds, resolved);
    }

    if (descriptors.length === 0) continue;

    // Clip length = the longest layer's frame list; shorter layers (e.g. a
    // 1-frame body under a multi-frame gun overlay) wrap via modulo.
    const clipLen = Math.max(
      1,
      ...clip.layers.map((l, i) =>
        descriptors[i] ? frameOrderFor(l, descriptors[i]).length : 1,
      ),
    );
    const orders = clip.layers.map((l, i) =>
      descriptors[i] ? frameOrderFor(l, descriptors[i]) : [0],
    );

    for (let t = 0; t < clipLen; t += 1) {
      sequence.push(buildStep(descriptors, orders, t));
    }
    const hold = clip.holdFrames ?? 0;
    for (let h = 0; h < hold; h += 1) {
      sequence.push(buildStep(descriptors, orders, clipLen - 1));
    }
  }

  return { available, sequence, bounds };
}

function buildStep(
  descriptors: ReadonlyArray<LayerDescriptor>,
  orders: ReadonlyArray<ReadonlyArray<number>>,
  t: number,
): SequenceStep {
  const draws: { layer: LayerDescriptor; frameIndex: number }[] = [];
  descriptors.forEach((layer, i) => {
    const order = orders[i];
    if (!order || order.length === 0) return;
    draws.push({ layer, frameIndex: order[t % order.length] });
  });
  return { draws };
}

function frameOrderFor(
  spec: PreviewLayerSpec,
  desc: LayerDescriptor,
): ReadonlyArray<number> {
  if (spec.frameOrder && spec.frameOrder.length > 0) return spec.frameOrder;
  return Array.from({ length: desc.cutRects.length }, (_, i) => i);
}

// Builds one layer descriptor. `base` is the clip's already-resolved base layer
// (null when resolving the base itself), needed to position an attached layer.
function resolveLayer(
  scene: Phaser.Scene,
  spec: PreviewLayerSpec,
  base: LayerDescriptor | null,
): LayerDescriptor | null {
  const info = getAnimationFrameInfo(spec.textureKey);
  if (!info || !scene.textures.exists(spec.textureKey)) return null;

  const cutRects: { x: number; y: number; w: number; h: number }[] = [];
  let image: CanvasImageSource | null = null;
  for (let i = 0; i < info.frameCount; i += 1) {
    const frame = scene.textures.getFrame(spec.textureKey, i);
    if (!frame) break;
    image = frame.source.image as CanvasImageSource;
    cutRects.push({
      x: frame.cutX,
      y: frame.cutY,
      w: frame.cutWidth,
      h: frame.cutHeight,
    });
  }
  if (!image || cutRects.length === 0) return null;

  if (spec.attach) {
    if (!base) return null; // an attached layer needs a base to ride on
    // Base sprite's display origin point (anchorX horizontally, vertical
    // centre), in display units relative to the ground point.
    const ownerX = 0; // ground sits under the base's anchorX column
    const ownerY = (base.frameHeight / 2 - baseAnchorY(base)) * base.scale;
    const scale = spec.attach.scale;
    return {
      image,
      cutRects,
      frameWidth: info.frameWidth,
      frameHeight: info.frameHeight,
      scale,
      originPxX: spec.attach.originX * info.frameWidth,
      originPxY: spec.attach.originY * info.frameHeight,
      pivotX: ownerX + spec.attach.offsetX * scale,
      pivotY: ownerY + spec.attach.offsetY * scale,
      rotation: spec.attach.rotation ?? 0,
    };
  }

  // Base layer: pivot is its anchor, which maps onto the ground point (0,0).
  return {
    image,
    cutRects,
    frameWidth: info.frameWidth,
    frameHeight: info.frameHeight,
    scale: info.displayScale,
    originPxX: info.anchorX,
    originPxY: info.anchorY,
    pivotX: 0,
    pivotY: 0,
    rotation: 0,
  };
}

// Recovers a base descriptor's source-pixel anchorY from its stored geometry
// (base pivot == anchor, so originPxY is the anchorY).
function baseAnchorY(base: LayerDescriptor): number {
  return base.originPxY;
}

// Expands `bounds` to include a layer's drawn rect (display units, relative to
// ground), accounting for any fixed rotation about its pivot.
function growBounds(bounds: Bounds, layer: LayerDescriptor): void {
  const s = layer.scale;
  const left = -layer.originPxX * s;
  const top = -layer.originPxY * s;
  const right = left + layer.frameWidth * s;
  const bottom = top + layer.frameHeight * s;

  const corners: ReadonlyArray<[number, number]> = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  for (const [cx, cy] of corners) {
    let x = cx;
    let y = cy;
    if (layer.rotation) {
      const cos = Math.cos(layer.rotation);
      const sin = Math.sin(layer.rotation);
      x = cx * cos - cy * sin;
      y = cx * sin + cy * cos;
    }
    x += layer.pivotX;
    y += layer.pivotY;
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;
  }
}
