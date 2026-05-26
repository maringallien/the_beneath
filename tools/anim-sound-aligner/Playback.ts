import {
  ensureAudioReady,
  getCachedBuffer,
  loadSound,
  playBufferOnce,
} from './AudioLoader';
import type { PreviewScene } from './PreviewScene';

// Orchestrates "play the animation and the chosen audio in lockstep, loop
// continuously". Lockstep is enforced by re-scheduling audio at every
// animation loop iteration (PreviewScene fires onLoopRestart on
// ANIMATION_REPEAT). For sub-second SFX this hard-restart approach removes
// the whole class of clock drift between Phaser RAF and WebAudio's clock.

export interface PlaybackConfig {
  readonly soundId: string | null;
  readonly soundPath: string | null;
  readonly audioOffsetFrames: number;
  readonly fps: number;
}

export class Playback {
  private readonly scene: PreviewScene;
  private stopAudio: (() => void) | null = null;
  private config: PlaybackConfig = {
    soundId: null,
    soundPath: null,
    audioOffsetFrames: 0,
    fps: 12,
  };
  private playing: boolean = false;

  constructor(scene: PreviewScene) {
    this.scene = scene;
  }

  setConfig(config: PlaybackConfig): void {
    this.config = config;
  }

  // Triggered from PreviewScene's onLoopRestart callback. We restart audio
  // at every loop boundary so any drift never accumulates across iterations.
  onLoopRestart(): void {
    if (!this.playing) return;
    this.stopAudioImmediate();
    void this.scheduleAudio();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  async play(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    await ensureAudioReady();
    this.scene.play();
    await this.scheduleAudio();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.scene.pause();
    this.stopAudioImmediate();
  }

  // Scrub is exposed as a pass-through here so callers don't need both
  // handles. Pausing the audio mid-scrub is the right behavior — the user
  // is iterating on alignment, not listening.
  seekTo(frameIndex: number): void {
    this.pause();
    this.scene.seekTo(frameIndex);
  }

  stepFrame(delta: 1 | -1): void {
    this.pause();
    this.scene.stepFrame(delta);
  }

  private async scheduleAudio(): Promise<void> {
    const { soundId, soundPath, audioOffsetFrames, fps } = this.config;
    if (!soundId || !soundPath) return;
    let buffer = getCachedBuffer(soundId);
    if (!buffer) {
      try {
        buffer = await loadSound(soundId, soundPath);
      } catch (err) {
        // Surface the failure to the console — the EditPanel's status line
        // is the user-visible channel for sound load errors and is updated
        // by main.ts.
        // eslint-disable-next-line no-console
        console.error('audio decode failed', err);
        return;
      }
    }
    // Bail if a pause raced us between fetch start and end.
    if (!this.playing) return;
    const frameDurSec = 1 / fps;
    // Positive offset = audio starts later (delay against context.currentTime).
    // Negative offset = audio "started" before frame 0, so we seek into the
    // buffer by |offset| frames so the visible playback begins partway in.
    const offsetSec = audioOffsetFrames * frameDurSec;
    const bufferOffsetSec = offsetSec < 0 ? -offsetSec : 0;
    const startDelaySec = offsetSec > 0 ? offsetSec : 0;
    this.stopAudio = playBufferOnce(buffer, bufferOffsetSec, startDelaySec);
  }

  private stopAudioImmediate(): void {
    if (this.stopAudio) {
      this.stopAudio();
      this.stopAudio = null;
    }
  }
}
