import Phaser from 'phaser';
import {
  DEFAULT_CHARACTER_FPS,
  listAnimations,
  type AnimationListing,
} from '../../src/sprites/characterLoader';
import { getAllSoundDefinitions } from '../../src/audio/soundRegistryLoader';
import type { SoundDefinition } from '../../src/audio/soundRegistryTypes';
import { AnimationList } from './AnimationList';
import { ensureAudioReady, getCachedBuffer, loadSound } from './AudioLoader';
import { EditPanel } from './EditPanel';
import { Playback } from './Playback';
import { PreviewScene } from './PreviewScene';
import {
  INITIAL_STATE,
  addOrUpdateTrigger,
  getTriggersForAnim,
  removeTrigger,
  setAllTriggers,
  setAudioOffsetFrames,
  setCurrentFrameIndex,
  setPlaying,
  setSelectedAnim,
  setSelectedSound,
  type AlignerState,
  type Trigger,
} from './state';
import { loadTriggers, saveTriggers } from './persist';
import { WaveformView } from './WaveformView';

const CONTAINER_ID = 'anim-sound-aligner-canvas';
const LIST_WIDTH = 280;
const PANEL_WIDTH = 360;
const HEADER_HEIGHT = 41;
const WAVEFORM_HEIGHT = 120;
const PREVIEW_ZOOM = 4;

function getCenterDims(): {
  width: number;
  height: number;
  left: number;
} {
  const width = window.innerWidth - LIST_WIDTH - PANEL_WIDTH;
  const height = window.innerHeight - HEADER_HEIGHT - WAVEFORM_HEIGHT;
  return { width, height, left: LIST_WIDTH };
}

function countTriggers(
  map: ReadonlyMap<string, ReadonlyArray<Trigger>>,
): number {
  let n = 0;
  for (const list of map.values()) n += list.length;
  return n;
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) {
    throw new Error(`Missing container element #${CONTAINER_ID}`);
  }

  const listings = listAnimations();
  const listingByKey: Map<string, AnimationListing> = new Map(
    listings.map((l) => [l.fullKey, l]),
  );
  const soundDefs: ReadonlyArray<readonly [string, SoundDefinition]> =
    getAllSoundDefinitions();
  const soundDefById: Map<string, SoundDefinition> = new Map(soundDefs);

  // Seed state from disk if a triggers file already exists. Missing file
  // is the normal first-run state; broken file surfaces in the status line.
  const initialLoad = await loadTriggers();

  let state: AlignerState = setAllTriggers(
    {
      ...INITIAL_STATE,
      selectedAnimKey: listings[0]?.fullKey ?? null,
    },
    initialLoad.data,
  );

  let sceneInstance: PreviewScene | null = null;
  let playback: Playback | null = null;

  const setState = (next: AlignerState): void => {
    if (next === state) return;
    const animChanged = next.selectedAnimKey !== state.selectedAnimKey;
    state = next;
    list.render(state);
    panel.render(state);
    drawWaveform();
    if (sceneInstance && animChanged) {
      sceneInstance.selectAnimation(state.selectedAnimKey);
    }
    syncPlaybackConfig();
  };

  const dims = getCenterDims();

  container.style.cssText = [
    'position: fixed',
    `top: ${HEADER_HEIGHT}px`,
    `left: ${dims.left}px`,
    `width: ${dims.width}px`,
    `height: ${dims.height}px`,
    'background: #1e1e1e',
    'overflow: hidden',
  ].join(';');

  const waveformHost = document.createElement('div');
  waveformHost.style.cssText = [
    'position: fixed',
    `top: ${HEADER_HEIGHT + dims.height}px`,
    `left: ${dims.left}px`,
    `width: ${dims.width}px`,
    `height: ${WAVEFORM_HEIGHT}px`,
    'box-sizing: border-box',
  ].join(';');
  document.body.appendChild(waveformHost);

  const list = new AnimationList(document.body, {
    onSelect: (fullKey) => {
      setState(setSelectedAnim(state, fullKey));
    },
  });
  list.setListings(listings);

  const panel = new EditPanel(document.body, {
    onSelectSound: (soundId) => {
      setState(setSelectedSound(state, soundId));
      if (soundId) void preloadSoundFor(soundId);
    },
    onTogglePlay: () => {
      if (!playback) return;
      if (playback.isPlaying()) {
        playback.pause();
        setState(setPlaying(state, false));
      } else {
        void playback.play().then(() => {
          setState(setPlaying(state, true));
        });
      }
    },
    onStepFrame: (delta) => {
      if (!playback) return;
      playback.stepFrame(delta);
      const frame = sceneInstance?.getCurrentFrameIndex() ?? -1;
      setState(setPlaying(setCurrentFrameIndex(state, frame), false));
    },
    onScrubTo: (frameIndex) => {
      if (!playback) return;
      playback.seekTo(frameIndex);
      setState(setPlaying(setCurrentFrameIndex(state, frameIndex), false));
    },
    onAudioOffsetChange: (offsetFrames) => {
      setState(setAudioOffsetFrames(state, offsetFrames));
    },
    onAddOrUpdateTrigger: (name, soundId, frameIndex, audioStartOffsetMs) => {
      const animKey = state.selectedAnimKey;
      if (!animKey) return;
      const trigger: Trigger =
        audioStartOffsetMs > 0
          ? { name, soundId, frameIndex, audioStartOffsetMs }
          : { name, soundId, frameIndex };
      setState(addOrUpdateTrigger(state, animKey, trigger));
    },
    onRemoveTrigger: (name) => {
      const animKey = state.selectedAnimKey;
      if (!animKey) return;
      setState(removeTrigger(state, animKey, name));
    },
    onEditTrigger: (_name, soundId, frameIndex, audioStartOffsetMs) => {
      // Loading an existing trigger into the editor: align the waveform
      // to its frame and select its sound so the user sees what they're
      // editing. Re-using the same name on the next Add/Update replaces
      // the entry in place (state.addOrUpdateTrigger dedupes by name).
      //
      // Reverse the slider→(frameIndex, audioStartOffsetMs) split so a
      // trigger with a head-cut shows up at its visually-correct negative
      // slider position rather than at the literal frameIndex.
      const offsetFrames = (audioStartOffsetMs * DEFAULT_CHARACTER_FPS) / 1000;
      const sliderValue = Math.round(frameIndex - offsetFrames);
      let next = setSelectedSound(state, soundId);
      next = setAudioOffsetFrames(next, sliderValue);
      setState(next);
      void preloadSoundFor(soundId);
    },
    onResetAll: () => {
      setState(setAllTriggers(state, new Map()));
      panel.setStatus('All in-memory triggers cleared (not saved yet).');
    },
    onSave: () => {
      void (async () => {
        panel.setStatus('Saving…');
        const result = await saveTriggers(state.triggersByAnim);
        if (result.ok) {
          panel.setStatus(
            result.mode === 'download'
              ? 'Saved (download) — drop the file into src/audio/.'
              : 'Saved to src/audio/animationSoundTriggers.json.',
          );
        } else {
          panel.setStatus(
            `Save failed: ${result.errors.join('; ') || 'unknown error'}`,
            true,
          );
        }
      })();
    },
  });
  panel.setListings(listings);
  panel.setSoundDefinitions(soundDefs);
  panel.setDefaultFps(DEFAULT_CHARACTER_FPS);

  const waveform = new WaveformView(waveformHost, {
    onAudioOffsetChange: (offsetFrames) => {
      setState(setAudioOffsetFrames(state, offsetFrames));
    },
    onScrubTo: (frameIndex) => {
      if (!playback) return;
      playback.seekTo(frameIndex);
      setState(setPlaying(setCurrentFrameIndex(state, frameIndex), false));
    },
  });
  waveform.resize(dims.width, WAVEFORM_HEIGHT);

  const scene = new PreviewScene({
    width: dims.width,
    height: dims.height,
    initialZoom: PREVIEW_ZOOM,
    callbacks: {
      onFrameChange: (frameIndex) => {
        setState(setCurrentFrameIndex(state, frameIndex));
      },
      onLoopRestart: () => {
        playback?.onLoopRestart();
      },
    },
    onReady: () => {
      sceneInstance = scene;
      scene.setListings(listings);
      scene.selectAnimation(state.selectedAnimKey);
      playback = new Playback(scene);
      syncPlaybackConfig();
      panel.render(state);
      drawWaveform();
    },
  });

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: CONTAINER_ID,
    width: dims.width,
    height: dims.height,
    backgroundColor: '#1e1e1e',
    scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
    render: { pixelArt: true, antialias: false },
    scene: [scene],
  });

  window.addEventListener('resize', () => {
    const next = getCenterDims();
    container.style.width = `${next.width}px`;
    container.style.height = `${next.height}px`;
    waveformHost.style.top = `${HEADER_HEIGHT + next.height}px`;
    waveformHost.style.width = `${next.width}px`;
    waveform.resize(next.width, WAVEFORM_HEIGHT);
    sceneInstance?.scale.resize(next.width, next.height);
  });

  if (!initialLoad.ok && initialLoad.error) {
    panel.setStatus(
      `Couldn't load existing triggers: ${initialLoad.error}`,
      true,
    );
  } else if (initialLoad.data.size > 0) {
    panel.setStatus(
      `Loaded ${countTriggers(initialLoad.data)} trigger(s) from disk.`,
    );
  } else {
    panel.setStatus('No triggers yet — author and save to create one.');
  }

  if (state.selectedSoundId) {
    void preloadSoundFor(state.selectedSoundId);
  }

  panel.render(state);
  list.render(state);

  // ---- closures ----------------------------------------------------

  function drawWaveform(): void {
    const animKey = state.selectedAnimKey;
    if (!animKey) {
      waveform.clear();
      return;
    }
    const listing = listingByKey.get(animKey);
    if (!listing) {
      waveform.clear();
      return;
    }
    const soundId = state.selectedSoundId;
    const buffer = soundId ? getCachedBuffer(soundId) : null;
    waveform.draw({
      frameCount: listing.anim.frames.frameCount,
      fps: DEFAULT_CHARACTER_FPS,
      buffer,
      audioOffsetFrames: state.audioOffsetFrames,
      scrubFrameIndexOneBased: state.currentFrameIndex,
      triggers: getTriggersForAnim(state, animKey),
      highlightTriggerName: null,
    });
  }

  function syncPlaybackConfig(): void {
    if (!playback) return;
    const soundId = state.selectedSoundId;
    const def = soundId ? soundDefById.get(soundId) ?? null : null;
    playback.setConfig({
      soundId,
      soundPath: def?.path ?? null,
      audioOffsetFrames: state.audioOffsetFrames,
      fps: DEFAULT_CHARACTER_FPS,
    });
  }

  async function preloadSoundFor(soundId: string): Promise<void> {
    const def = soundDefById.get(soundId);
    if (!def) return;
    await ensureAudioReady();
    try {
      const buffer = await loadSound(soundId, def.path);
      panel.setSoundDuration(soundId, buffer.duration * 1000);
      drawWaveform();
    } catch (err) {
      panel.setStatus(`Failed to decode "${soundId}": ${String(err)}`, true);
    }
  }
}

void bootstrap();
