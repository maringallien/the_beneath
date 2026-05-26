// Horizontal frame timeline rendered as a canvas strip. Click a tick to
// seek the preview to that frame (and pause). Mirrors the click-to-scrub
// behavior in anim-sound-aligner/WaveformView, minus the audio waveform
// — the resizer only cares about which frame is showing so the user can
// stage a hitbox before dragging it.

const BG_COLOR = '#141414';
const TICK_COLOR = '#3a3a3a';
const TICK_LABEL_COLOR = '#777';
const SCRUB_COLOR = '#ff3355';
const HITBOX_FRAME_COLOR = '#ffd166';

export interface FrameStripCallbacks {
  readonly onScrubTo: (frameIndexZeroBased: number) => void;
}

export interface FrameStripInputs {
  readonly frameCount: number;
  // 0-based current frame index (matches Phaser-internal 0-based but offset
  // from the display's 1-based label).
  readonly currentFrameIndex: number;
  // Frames (0-based) that carry an attack hitbox for the current animation.
  // Drawn as colored bands so the user can scrub straight to them.
  readonly hitboxFrames: ReadonlyArray<number>;
}

export class FrameStrip {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly callbacks: FrameStripCallbacks;

  private widthCss = 0;
  private heightCss = 48;
  private dpr = window.devicePixelRatio || 1;
  private currentInputs: FrameStripInputs | null = null;

  constructor(parent: HTMLElement, callbacks: FrameStripCallbacks) {
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position: relative',
      `height: ${this.heightCss}px`,
      `background: ${BG_COLOR}`,
      'border-top: 1px solid #2a2a2a',
      'cursor: pointer',
      'overflow: hidden',
    ].join(';');
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display: block; width: 100%; height: 100%;';
    this.root.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for FrameStrip canvas');
    this.ctx = ctx;
    parent.appendChild(this.root);
    this.wireEvents();
  }

  element(): HTMLDivElement {
    return this.root;
  }

  resize(widthCss: number, heightCss: number): void {
    this.widthCss = widthCss;
    this.heightCss = heightCss;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(widthCss * this.dpr);
    this.canvas.height = Math.round(heightCss * this.dpr);
    this.root.style.height = `${heightCss}px`;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
    if (this.currentInputs) this.draw(this.currentInputs);
  }

  clear(): void {
    this.currentInputs = null;
    this.ctx.fillStyle = BG_COLOR;
    this.ctx.fillRect(0, 0, this.widthCss, this.heightCss);
  }

  draw(inputs: FrameStripInputs): void {
    this.currentInputs = inputs;
    if (this.widthCss === 0 || this.heightCss === 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, this.widthCss, this.heightCss);

    const { frameCount, currentFrameIndex, hitboxFrames } = inputs;
    if (frameCount <= 0) return;

    const colWidth = this.widthCss / frameCount;

    // Hitbox-frame bands first so the tick lines layer on top of them.
    const hitboxSet = new Set<number>(hitboxFrames);
    ctx.fillStyle = HITBOX_FRAME_COLOR;
    ctx.globalAlpha = 0.22;
    for (const frame of hitboxSet) {
      if (frame < 0 || frame >= frameCount) continue;
      ctx.fillRect(frame * colWidth, 0, colWidth, this.heightCss);
    }
    ctx.globalAlpha = 1;

    // Frame ticks + labels. Use 1-based labels (the visible playback frame
    // count the user sees in the registry frame counts is 0-based, but the
    // sound-aligner's label scheme uses 1-based; here we show 0-based to
    // match the registry's `frame:` index).
    ctx.strokeStyle = TICK_COLOR;
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = TICK_LABEL_COLOR;
    const labelEvery = frameCount <= 16 ? 1 : Math.ceil(frameCount / 16);
    for (let f = 0; f <= frameCount; f++) {
      const x = Math.round(f * colWidth) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.heightCss);
      ctx.stroke();
      if (f < frameCount && f % labelEvery === 0) {
        ctx.fillText(String(f), x + 2, 12);
      }
    }

    // Scrub head — red vertical line at the center of the current frame's
    // column so it's clearly inside that frame band.
    if (currentFrameIndex >= 0 && currentFrameIndex < frameCount) {
      const x = Math.round((currentFrameIndex + 0.5) * colWidth) + 0.5;
      ctx.strokeStyle = SCRUB_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.heightCss);
      ctx.stroke();
      ctx.lineWidth = 1;
      // Big frame label at bottom to make the active frame obvious.
      ctx.fillStyle = SCRUB_COLOR;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`f${currentFrameIndex}`, x + 4, this.heightCss - 4);
    }
  }

  private wireEvents(): void {
    // Plain click = scrub. Drag is treated as a sequence of scrubs so the
    // user can sweep the strip and watch the preview update live.
    let isDown = false;
    const scrubAt = (clientX: number) => {
      if (!this.currentInputs) return;
      const rect = this.canvas.getBoundingClientRect();
      const localX = clientX - rect.left;
      const colWidth = this.widthCss / this.currentInputs.frameCount;
      const frame = Math.max(
        0,
        Math.min(this.currentInputs.frameCount - 1, Math.floor(localX / colWidth)),
      );
      this.callbacks.onScrubTo(frame);
    };
    this.canvas.addEventListener('mousedown', (e) => {
      isDown = true;
      scrubAt(e.clientX);
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      scrubAt(e.clientX);
    });
    window.addEventListener('mouseup', () => {
      isDown = false;
    });
  }
}
