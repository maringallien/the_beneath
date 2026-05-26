import { computePeaks } from './AudioLoader';
import type { Trigger } from './state';

const WAVE_COLOR = '#66c0ff';
const TRIGGER_COLOR = '#ffd866';
const SCRUB_COLOR = '#ff3355';
const TICK_COLOR = '#3a3a3a';
const TICK_LABEL_COLOR = '#777';
const BG_COLOR = '#141414';

export interface WaveformViewCallbacks {
  // Fired when the user drags the audio horizontally — delta in whole
  // frames, accumulated against the current offset by main.ts.
  readonly onAudioOffsetChange: (offsetFrames: number) => void;
  // Fired when the user clicks on a frame tick or empty timeline area.
  readonly onScrubTo: (frameIndexOneBased: number) => void;
}

export interface WaveformInputs {
  // Animation parameters (mandatory for any draw — empty state is handled
  // explicitly by the caller via clear()).
  readonly frameCount: number;
  readonly fps: number;
  // Audio parameters. null buffer = render the frame timeline only.
  readonly buffer: AudioBuffer | null;
  readonly audioOffsetFrames: number;
  readonly scrubFrameIndexOneBased: number;
  readonly triggers: ReadonlyArray<Trigger>;
  // Optional highlight (e.g. of the trigger name currently being authored
  // so the user can find it among many).
  readonly highlightTriggerName: string | null;
}

export class WaveformView {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly callbacks: WaveformViewCallbacks;

  private widthCss: number = 0;
  private heightCss: number = 80;
  private dpr: number = window.devicePixelRatio || 1;

  // Cached peaks for the last-drawn buffer + bucket count. Recomputed
  // whenever the canvas resizes or the buffer changes.
  private peakCache: { buffer: AudioBuffer; bucketCount: number; peaks: Float32Array } | null = null;

  private currentInputs: WaveformInputs | null = null;

  // Drag anchor: the offset value at the moment the mouse went down. The
  // mouse-move handler computes a frame-delta against this anchor and
  // emits `anchor + delta`, so rapid drag movements never accumulate
  // rounding error from incremental updates.
  private dragAnchorOffsetFrames: number = 0;

  constructor(parent: HTMLElement, callbacks: WaveformViewCallbacks) {
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'anim-sound-aligner-waveform';
    this.root.style.cssText = [
      'position: relative',
      `height: ${this.heightCss}px`,
      `background: ${BG_COLOR}`,
      'border-top: 1px solid #2a2a2a',
      'cursor: ew-resize',
      'overflow: hidden',
    ].join(';');

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display: block; width: 100%; height: 100%;';
    this.root.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for waveform canvas');
    this.ctx = ctx;

    parent.appendChild(this.root);
    this.wireEvents();
  }

  // Reflows after the surrounding layout settles, the canvas's CSS width is
  // turned into a backing-store size for HiDPI rendering.
  resize(widthCss: number, heightCss: number): void {
    this.widthCss = widthCss;
    this.heightCss = heightCss;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(widthCss * this.dpr);
    this.canvas.height = Math.round(heightCss * this.dpr);
    this.root.style.height = `${heightCss}px`;
    // Reset transform before applying a new one — repeated resizes would
    // otherwise scale-compound.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
    this.invalidatePeakCache();
    if (this.currentInputs) this.draw(this.currentInputs);
  }

  clear(): void {
    this.currentInputs = null;
    this.ctx.fillStyle = BG_COLOR;
    this.ctx.fillRect(0, 0, this.widthCss, this.heightCss);
  }

  draw(inputs: WaveformInputs): void {
    this.currentInputs = inputs;
    if (this.widthCss === 0 || this.heightCss === 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, this.widthCss, this.heightCss);

    const { frameCount, fps, buffer, audioOffsetFrames, triggers } = inputs;
    if (frameCount <= 0 || fps <= 0) return;

    const frameDurMs = 1000 / fps;
    const animDurMs = frameCount * frameDurMs;
    const pxPerMs = this.widthCss / animDurMs;

    // Frame ticks — vertical lines every frame boundary, labels every few
    // frames so a high-frameCount animation doesn't drown in numbers.
    ctx.strokeStyle = TICK_COLOR;
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = TICK_LABEL_COLOR;
    const labelEvery = frameCount <= 16 ? 1 : Math.ceil(frameCount / 16);
    for (let f = 0; f <= frameCount; f++) {
      const x = Math.round(f * frameDurMs * pxPerMs) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.heightCss);
      ctx.stroke();
      if (f % labelEvery === 0 && f >= 1 && f <= frameCount) {
        ctx.fillText(String(f), x + 2, 10);
      }
    }

    // Waveform — only when an audio buffer is available. X-position of
    // bucket B = (B/bucketCount * audioDurMs + audioOffsetFrames *
    // frameDurMs) * pxPerMs. Buckets that land outside [0, widthCss] are
    // clipped naturally because canvas drawing handles off-canvas coords.
    if (buffer) {
      const audioStartMs = audioOffsetFrames * frameDurMs;
      const audioEndMs = audioStartMs + buffer.duration * 1000;
      const startX = audioStartMs * pxPerMs;
      const endX = audioEndMs * pxPerMs;
      const waveWidthPx = Math.max(1, endX - startX);
      const bucketCount = Math.max(1, Math.round(waveWidthPx));
      const peaks = this.getPeaks(buffer, bucketCount);
      const midY = this.heightCss / 2;
      const maxAmp = this.heightCss * 0.45;
      ctx.fillStyle = WAVE_COLOR;
      for (let i = 0; i < peaks.length; i++) {
        const x = startX + i;
        if (x < -1 || x > this.widthCss + 1) continue;
        const amp = peaks[i] * maxAmp;
        ctx.fillRect(x, midY - amp, 1, amp * 2);
      }
      // Subtle bracketing lines at the audio start / end so the user can
      // see exactly where the buffer begins and ends regardless of
      // amplitude at the edges.
      ctx.strokeStyle = WAVE_COLOR;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, this.heightCss);
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, this.heightCss);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Trigger markers — yellow vertical bars at each authored trigger's
    // frame. The highlightTriggerName, when set, draws a thicker stroke
    // around its marker.
    for (const trig of triggers) {
      const x = Math.round((trig.frameIndex - 1) * frameDurMs * pxPerMs) + 0.5;
      const isHighlight = inputs.highlightTriggerName === trig.name;
      ctx.strokeStyle = TRIGGER_COLOR;
      ctx.lineWidth = isHighlight ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.heightCss);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = TRIGGER_COLOR;
      ctx.fillText(trig.name, x + 3, this.heightCss - 4);
    }

    // Scrub head — red vertical line at the current playhead.
    const scrubFrame = inputs.scrubFrameIndexOneBased;
    if (scrubFrame >= 1 && scrubFrame <= frameCount) {
      const x = Math.round((scrubFrame - 1) * frameDurMs * pxPerMs) + 0.5;
      ctx.strokeStyle = SCRUB_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.heightCss);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  private wireEvents(): void {
    // Click without drag scrubs to the clicked frame; drag-with-shift OR
    // a drag larger than a small threshold pans the audio offset. Plain
    // click = scrub keeps the common case (jump to a frame) one-click.
    const SHIFT_DRAG_THRESHOLD_PX = 4;
    let mouseDownX: number | null = null;
    let didDrag = false;
    let dragMode: 'audio' | null = null;

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      mouseDownX = e.clientX - rect.left;
      didDrag = false;
      dragMode = null;
      this.dragAnchorOffsetFrames =
        this.currentInputs?.audioOffsetFrames ?? 0;
      // Shift+drag = immediately pan the audio offset (cleaner than
      // mode-switching on click target detection).
      if (e.shiftKey) {
        dragMode = 'audio';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (mouseDownX === null) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const dx = x - mouseDownX;
      if (!didDrag && Math.abs(dx) > SHIFT_DRAG_THRESHOLD_PX) {
        didDrag = true;
        // Promote into audio-pan mode even without shift held, on the
        // assumption that a user dragging more than a few pixels wants to
        // move the audio. The plain-click scrub path only fires if the
        // mouse never moved far on release.
        dragMode = dragMode ?? 'audio';
      }
      if (didDrag && dragMode === 'audio' && this.currentInputs) {
        const { frameCount, fps } = this.currentInputs;
        const frameDurMs = 1000 / fps;
        const animDurMs = frameCount * frameDurMs;
        const pxPerMs = this.widthCss / animDurMs;
        const deltaMs = dx / pxPerMs;
        const deltaFrames = Math.round(deltaMs / frameDurMs);
        const next = this.dragAnchorOffsetFrames + deltaFrames;
        this.callbacks.onAudioOffsetChange(next);
      }
    });

    window.addEventListener('mouseup', () => {
      if (mouseDownX !== null && !didDrag && this.currentInputs) {
        const { frameCount, fps } = this.currentInputs;
        const frameDurMs = 1000 / fps;
        const pxPerMs = this.widthCss / (frameCount * frameDurMs);
        const frameIdx = Math.round(mouseDownX / pxPerMs / frameDurMs) + 1;
        this.callbacks.onScrubTo(
          Math.max(1, Math.min(frameCount, frameIdx)),
        );
      }
      mouseDownX = null;
      didDrag = false;
      dragMode = null;
    });
  }

  private getPeaks(
    buffer: AudioBuffer,
    bucketCount: number,
  ): Float32Array {
    const cache = this.peakCache;
    if (cache && cache.buffer === buffer && cache.bucketCount === bucketCount) {
      return cache.peaks;
    }
    const peaks = computePeaks(buffer, bucketCount);
    this.peakCache = { buffer, bucketCount, peaks };
    return peaks;
  }

  private invalidatePeakCache(): void {
    this.peakCache = null;
  }
}
