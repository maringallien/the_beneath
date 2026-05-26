// Decodes registry-declared sounds into AudioBuffers and computes peak
// arrays for waveform rendering. One AudioContext is shared across the
// tool — browsers cap the number a page may create.
//
// Caching policy: decode results are kept indefinitely (the tool's session
// is short and there are only a few SFX). Peak buffers are recomputed on
// demand because the bucket count depends on the canvas width.

let sharedContext: AudioContext | null = null;
const BUFFER_CACHE: Map<string, AudioBuffer> = new Map();

function getContext(): AudioContext {
  if (sharedContext === null) {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

// Resume the underlying AudioContext if a user gesture is required. Browsers
// suspend audio contexts created before any user interaction; calling this
// from inside a click handler unblocks subsequent decode/play calls.
export async function ensureAudioReady(): Promise<void> {
  const ctx = getContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}

// Fetches the file at `path` (registry-relative — same convention Phaser
// uses for `scene.load.audio`), decodes it, and caches by soundId. Repeat
// calls for the same soundId return the cached buffer without re-fetching.
export async function loadSound(
  soundId: string,
  path: string,
): Promise<AudioBuffer> {
  const cached = BUFFER_CACHE.get(soundId);
  if (cached) return cached;
  const url = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const buffer = await getContext().decodeAudioData(bytes);
  BUFFER_CACHE.set(soundId, buffer);
  return buffer;
}

export function getCachedBuffer(soundId: string): AudioBuffer | null {
  return BUFFER_CACHE.get(soundId) ?? null;
}

// Reduces a single audio channel (mono mixdown if multi-channel) to an
// array of `bucketCount` peak magnitudes in [0, 1]. Used by WaveformView
// to draw at canvas-pixel resolution without iterating all sample frames.
export function computePeaks(
  buffer: AudioBuffer,
  bucketCount: number,
): Float32Array {
  const out = new Float32Array(bucketCount);
  const channels = buffer.numberOfChannels;
  const sampleCount = buffer.length;
  if (sampleCount === 0 || bucketCount === 0) return out;
  const samplesPerBucket = Math.max(1, Math.floor(sampleCount / bucketCount));
  // Cache channel data refs so the inner loop doesn't repeatedly call
  // getChannelData (each call allocates).
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelData.push(buffer.getChannelData(c));
  }
  for (let i = 0; i < bucketCount; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(sampleCount, start + samplesPerBucket);
    let peak = 0;
    for (let s = start; s < end; s++) {
      // Mono mixdown via mean across channels — preserves the loudest
      // moment in any channel reasonably well for visualization purposes.
      let mixed = 0;
      for (let c = 0; c < channels; c++) {
        mixed += channelData[c][s];
      }
      mixed /= channels;
      const abs = Math.abs(mixed);
      if (abs > peak) peak = abs;
    }
    out[i] = peak;
  }
  return out;
}

// Plays a buffer once at the supplied bufferOffsetSec (seek into the audio
// buffer; useful for honoring negative animation-relative offsets). When
// startDelaySec > 0 the playback start is deferred against the audio
// context clock so positive animation-relative offsets line up. Returns a
// handle that stops playback when called.
export function playBufferOnce(
  buffer: AudioBuffer,
  bufferOffsetSec: number,
  startDelaySec: number,
): () => void {
  const ctx = getContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const when = ctx.currentTime + Math.max(0, startDelaySec);
  const offset = Math.max(0, Math.min(buffer.duration, bufferOffsetSec));
  source.start(when, offset);
  return () => {
    try {
      source.stop();
    } catch {
      // Already stopped or never reached start — safe to ignore.
    }
    source.disconnect();
  };
}
