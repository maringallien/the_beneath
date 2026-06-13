import Phaser from 'phaser';
import { getAnimationFrameInfo } from '../sprites/characterLoader';

/**
 * animatedSpritePreview — a self-driving spritesheet preview on a DOM <canvas>.
 *
 * Loops the player's sword / magic / gun attack frames in the "How to Play"
 * manual's Combat tab. It exists instead of a Phaser sprite because the pause
 * menu calls anims.pauseAll(), freezing every Phaser animation while the manual
 * is open: this widget owns its own requestAnimationFrame loop and blits frames
 * straight from the already-loaded spritesheet textures, so it keeps animating
 * regardless of the global AnimationManager state, and never touches the Phaser
 * display list (it is a plain DOM element the overlay positions with CSS). Frame
 * layout (size, count, anchor, displayScale) is read from the sprite registry via
 * getAnimationFrameInfo, so a preview can never drift from the in-game drawing.
 *
 * Inputs:  clip specs (texture keys, frame orders, optional gun-overlay attach)
 *          plus a fit box in CSS px; the registry's per-animation frame info.
 * Outputs: an <canvas> element that the widget animates on its own rAF loop.
 * @calledby the manual overlay, when showing the combat preview while the rest of
 *           the game (and its animations) is paused.
 * @calls    the sprite registry's frame-info lookup and the loaded textures'
 *           frame cut-rects, then 2D-canvas drawImage on each tick.
 */

// Gun overlay attach: positions a layer on the base sprite at a fixed grip offset (mirrors PlayerGun.syncToOwner).
export interface PreviewAttach {
  // Offset in source px from the base sprite's origin to this layer's pivot; multiplied by scale at draw time.
  readonly offsetX: number;
  readonly offsetY: number;
  // This layer's own pivot as a fraction of its frame (e.g. the gun grip).
  readonly originX: number;
  readonly originY: number;
  // Scale this layer (and the offset) is drawn at — the owner/body scale.
  readonly scale: number;
  // Optional fixed rotation in radians (default 0 → barrel points right).
  readonly rotation?: number;
}

export interface PreviewLayerSpec {
  // Phaser texture key for this layer's spritesheet.
  readonly textureKey: string;
  // Frames to show, in order. Defaults to every frame (0 … frameCount-1).
  readonly frameOrder?: ReadonlyArray<number>;
  // When present, this layer attaches to the base; when absent it is the base, ground-anchored. First layer must be base.
  readonly attach?: PreviewAttach;
}

export interface PreviewClipSpec {
  // Layers drawn back-to-front; layer 0 is the base (body or single-layer swing).
  readonly layers: ReadonlyArray<PreviewLayerSpec>;
  // Extra ticks to hold the last frame — a pause between combo swings / gun shots.
  readonly holdFrames?: number;
}

export interface AnimatedSpritePreviewOptions {
  readonly scene: Phaser.Scene;
  // Clips played in order then looped (one per combo step for sword/magic; idle beat + fire for guns).
  readonly clips: ReadonlyArray<PreviewClipSpec>;
  // Playback rate. Defaults to the character animation rate (12 fps).
  readonly fps?: number;
  // CSS-px box to fit the whole animation inside, aspect-preserved, feet on the bottom.
  readonly maxWidthPx: number;
  readonly maxHeightPx: number;
}

const DEFAULT_FPS = 12;
// A small padding around the union bounds so wide swing frames never clip the canvas border.
const BOUNDS_PADDING = 2;

// Resolved layer: source image, per-frame cut rects, and draw geometry in display units relative to the ground point.
interface LayerDescriptor {
  readonly image: CanvasImageSource;
  readonly cutRects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly scale: number; // display-unit scale (displayScale or body scale)
  readonly originPxX: number; // pivot within the frame in source px
  readonly originPxY: number;
  readonly pivotX: number; // pivot position in display units from ground point
  readonly pivotY: number;
  readonly rotation: number;
}

// One rendered tick: which frame each layer shows.
interface SequenceStep {
  readonly draws: ReadonlyArray<{ layer: LayerDescriptor; frameIndex: number }>;
}

// Mutable accumulator for the union of all layers' extents (display units, relative to the ground point).
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

  // Scales display units to device pixels for the backing store.
  private readonly fitScale: number;
  private readonly groundX: number;
  private readonly groundY: number;

  private rafId: number | null = null;
  private accumulatorMs = 0;
  private lastTimeMs = 0;
  private stepIndex = 0;

  // Resolves clips into a render sequence, sizes the canvas to the union bounds, and draws the first frame.
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

    // Fit within the box: tightest axis wins; backing store at device res so HiDPI stays crisp.
    this.fitScale = Math.min(
      (options.maxWidthPx * dpr) / unionW,
      (options.maxHeightPx * dpr) / unionH,
    );
    canvas.width = Math.max(1, Math.round(unionW * this.fitScale));
    canvas.height = Math.max(1, Math.round(unionH * this.fitScale));
    canvas.style.width = `${Math.round(canvas.width / dpr)}px`;
    canvas.style.height = `${Math.round(canvas.height / dpr)}px`;

    // Ground point in backing-store px (where every layer's baseline anchor maps).
    this.groundX = -built.bounds.minX * this.fitScale;
    this.groundY = -built.bounds.minY * this.fitScale;

    this.renderStep(0);
  }

  // True when every referenced texture loaded; false means the canvas is blank and the caller should show a fallback.
  isAvailable(): boolean {
    return this.available;
  }

  // Starts the rAF loop; no-op if already running, textures missing, or single static frame.
  start(): void {
    if (this.rafId !== null || !this.available || this.sequence.length <= 1) {
      return;
    }
    this.lastTimeMs = performance.now();
    this.accumulatorMs = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  // Halts the rAF loop if running; leaves the last frame on the canvas.
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // Stops the loop and removes the canvas from the DOM.
  destroy(): void {
    this.stop();
    this.el.remove();
  }

  // rAF callback: advances the frame index on each fps interval and re-renders; clamps accumulator after tab-switch gaps.
  private readonly tick = (now: number): void => {
    const frameMs = 1000 / this.fps;
    this.accumulatorMs += now - this.lastTimeMs;
    this.lastTimeMs = now;
    if (this.accumulatorMs > frameMs * 4) this.accumulatorMs = frameMs; // clamp after tab-switch gaps

    let advanced = false;
    while (this.accumulatorMs >= frameMs) {
      this.accumulatorMs -= frameMs;
      this.stepIndex = (this.stepIndex + 1) % this.sequence.length;
      advanced = true;
    }
    if (advanced) this.renderStep(this.stepIndex);

    this.rafId = requestAnimationFrame(this.tick);
  };

  // Clears the canvas and blits one sequence step back-to-front with nearest-neighbour scaling.
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

  // Blits one layer's frame at its pivot with combined layer×fit scale and optional rotation.
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

// Resolves all clips into a looping render sequence and accumulates the union bounds; returns available:false if any texture is missing.
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

    // Clip length = longest layer's frame list; shorter layers wrap via modulo.
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

// Builds one tick at clip-time t; short layers wrap under longer ones via modulo.
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

// Returns the spec's frame order, or all frames 0..n-1 when unspecified.
function frameOrderFor(
  spec: PreviewLayerSpec,
  desc: LayerDescriptor,
): ReadonlyArray<number> {
  if (spec.frameOrder && spec.frameOrder.length > 0) return spec.frameOrder;
  return Array.from({ length: desc.cutRects.length }, (_, i) => i);
}

// Builds a layer descriptor from its spec; base layers pivot on their anchor, attached layers ride the base at a fixed offset.
// Returns null if the texture is missing (makes the whole preview unavailable).
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
    // Base display origin in display units relative to the ground point.
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

  // Base layer: anchor maps onto the ground point (0,0).
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

// Recovers the base layer's source-pixel anchorY (stored as originPxY since base pivot == anchor).
function baseAnchorY(base: LayerDescriptor): number {
  return base.originPxY;
}

// Expands bounds to enclose a layer's drawn rect, rotating its corners first to capture rotated overlays correctly.
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
