import type { AnimationListing } from '../../src/sprites/characterLoader';
import type { SoundDefinition } from '../../src/audio/soundRegistryTypes';
import type { AlignerState } from './state';

// Trigger names must be a safe identifier — the save plugin enforces the
// same regex on the server side. Authored client-side as a fail-fast UX so
// the user doesn't hit a server validation error after clicking Save.
const TRIGGER_NAME_REGEX = /^[A-Za-z0-9_]+$/;

export interface EditPanelCallbacks {
  readonly onSelectSound: (soundId: string | null) => void;
  readonly onTogglePlay: () => void;
  readonly onStepFrame: (delta: 1 | -1) => void;
  readonly onScrubTo: (frameIndex: number) => void;
  readonly onAudioOffsetChange: (offsetFrames: number) => void;
  // `audioStartOffsetMs` lets a trigger fire at frame 1 yet play the *middle*
  // of its sound (caller cuts the head off the buffer). 0 = play from start.
  readonly onAddOrUpdateTrigger: (
    name: string,
    soundId: string,
    frameIndex: number,
    audioStartOffsetMs: number,
  ) => void;
  readonly onRemoveTrigger: (name: string) => void;
  // Loads an existing trigger back into the editor so the user can adjust
  // its frame and re-save without retyping the name. main.ts handles this
  // by setting the soundId + offset + populating the name input.
  readonly onEditTrigger: (
    name: string,
    soundId: string,
    frameIndex: number,
    audioStartOffsetMs: number,
  ) => void;
  readonly onResetAll: () => void;
  readonly onSave: () => void;
}

const PANEL_WIDTH = 360;

export class EditPanel {
  private readonly root: HTMLDivElement;
  private readonly emptyHint: HTMLDivElement;
  private readonly form: HTMLDivElement;

  private readonly selectedLabel: HTMLDivElement;
  private readonly animMetaLabel: HTMLDivElement;

  private readonly soundSelect: HTMLSelectElement;
  private readonly soundDurationLabel: HTMLSpanElement;
  private readonly playPauseBtn: HTMLButtonElement;
  private readonly stepBackBtn: HTMLButtonElement;
  private readonly stepFwdBtn: HTMLButtonElement;
  private readonly currentFrameLabel: HTMLSpanElement;

  private readonly offsetNumber: HTMLInputElement;
  private readonly offsetRange: HTMLInputElement;

  private readonly triggerNameInput: HTMLInputElement;
  private readonly addUpdateBtn: HTMLButtonElement;
  private readonly triggerList: HTMLDivElement;

  private readonly resetAllBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly statusLine: HTMLDivElement;

  private callbacks: EditPanelCallbacks;
  private listingByKey: Map<string, AnimationListing> = new Map();
  private soundDurationsMs: Map<string, number> = new Map();
  private currentState: AlignerState | null = null;
  // Default character FPS, supplied at boot. Used for the meta line's
  // duration calculation and for clamping the offset slider extent.
  private defaultFps: number = 12;

  constructor(parent: HTMLElement, callbacks: EditPanelCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.className = 'anim-sound-aligner-panel';
    this.root.style.cssText = [
      'position: fixed',
      'top: 41px',
      'right: 0',
      'bottom: 0',
      `width: ${PANEL_WIDTH}px`,
      'background: #0d0d0d',
      'border-left: 1px solid #2a2a2a',
      'color: #ddd',
      'padding: 12px',
      'box-sizing: border-box',
      'overflow-y: auto',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'font-size: 12px',
      'z-index: 5',
    ].join(';');

    this.emptyHint = document.createElement('div');
    this.emptyHint.textContent = 'Click an animation on the left to begin.';
    this.emptyHint.style.color = '#888';
    this.root.appendChild(this.emptyHint);

    this.form = document.createElement('div');
    this.form.style.display = 'none';
    this.root.appendChild(this.form);

    // Selected anim header + meta line ----------------------------------
    this.selectedLabel = document.createElement('div');
    this.selectedLabel.style.cssText = [
      'font-family: monospace',
      'font-size: 13px',
      'color: #9cdcfe',
      'margin-bottom: 2px',
      'word-break: break-all',
    ].join(';');
    this.form.appendChild(this.selectedLabel);

    this.animMetaLabel = document.createElement('div');
    this.animMetaLabel.style.cssText =
      'font-size: 11px; color: #888; margin-bottom: 12px;';
    this.form.appendChild(this.animMetaLabel);

    // Sound picker + duration -------------------------------------------
    const soundRow = document.createElement('div');
    soundRow.style.cssText = 'margin-bottom: 10px;';
    const soundLabel = document.createElement('div');
    soundLabel.textContent = 'Sound';
    soundLabel.style.cssText =
      'font-size: 11px; color: #aaa; margin-bottom: 4px;';
    soundRow.appendChild(soundLabel);
    const soundSelect = document.createElement('select');
    soundSelect.style.cssText = [
      'width: 100%',
      'background: #1e1e1e',
      'color: #ddd',
      'border: 1px solid #333',
      'padding: 4px',
      'box-sizing: border-box',
      'font-family: monospace',
      'font-size: 12px',
    ].join(';');
    this.soundSelect = soundSelect;
    soundRow.appendChild(soundSelect);
    this.soundDurationLabel = document.createElement('span');
    this.soundDurationLabel.style.cssText =
      'display: block; font-size: 11px; color: #888; margin-top: 2px;';
    soundRow.appendChild(this.soundDurationLabel);
    this.form.appendChild(soundRow);

    // Playback row ------------------------------------------------------
    const playRow = document.createElement('div');
    playRow.style.cssText =
      'display: flex; gap: 4px; align-items: center; margin-bottom: 10px;';
    this.stepBackBtn = this.makeSmallButton('◀ frame');
    this.playPauseBtn = this.makeSmallButton('Play');
    this.playPauseBtn.style.background = '#264f78';
    this.stepFwdBtn = this.makeSmallButton('frame ▶');
    this.currentFrameLabel = document.createElement('span');
    this.currentFrameLabel.style.cssText =
      'font-family: monospace; font-size: 12px; color: #cccccc; margin-left: 8px;';
    playRow.appendChild(this.stepBackBtn);
    playRow.appendChild(this.playPauseBtn);
    playRow.appendChild(this.stepFwdBtn);
    playRow.appendChild(this.currentFrameLabel);
    this.form.appendChild(playRow);

    // Trigger frame row -------------------------------------------------
    // This slider doubles as the audio-offset visualization on the
    // waveform AND the frameIndex of the saved trigger — they are the
    // same number conceptually (the frame at which the sound starts).
    const offsetRow = this.makeNumberSliderRow(
      'Trigger frame (≥1 fires at that frame · <1 cuts into audio)',
    );
    this.offsetRange = offsetRow.range;
    this.offsetNumber = offsetRow.number;
    this.offsetRange.min = '-30';
    this.offsetRange.max = '30';
    this.offsetRange.step = '1';
    this.offsetRange.value = '1';
    this.offsetNumber.min = '-30';
    this.offsetNumber.max = '30';
    this.offsetNumber.step = '1';
    this.offsetNumber.value = '1';
    this.form.appendChild(offsetRow.row);

    // Divider ----------------------------------------------------------
    const triggerDivider = document.createElement('hr');
    triggerDivider.style.cssText =
      'border: none; border-top: 1px solid #2a2a2a; margin: 12px 0;';
    this.form.appendChild(triggerDivider);

    // Trigger authoring -------------------------------------------------
    const triggerHeader = document.createElement('div');
    triggerHeader.textContent = 'Author trigger';
    triggerHeader.style.cssText =
      'font-weight: 600; color: #cccccc; margin-bottom: 6px;';
    this.form.appendChild(triggerHeader);

    const nameRow = document.createElement('div');
    nameRow.style.cssText =
      'display: flex; gap: 6px; align-items: center; margin-bottom: 6px;';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'name';
    nameLabel.style.cssText = 'font-size: 11px; color: #aaa; min-width: 38px;';
    nameRow.appendChild(nameLabel);
    this.triggerNameInput = document.createElement('input');
    this.triggerNameInput.type = 'text';
    this.triggerNameInput.placeholder = 'swing_whoosh';
    this.triggerNameInput.style.cssText = [
      'flex: 1',
      'background: #1e1e1e',
      'color: #ddd',
      'border: 1px solid #333',
      'padding: 4px',
      'font-family: monospace',
      'font-size: 12px',
    ].join(';');
    nameRow.appendChild(this.triggerNameInput);
    this.form.appendChild(nameRow);

    // The frame index of a new trigger is read from the "Trigger frame"
    // slider above — no separate input. A small hint reminds the user
    // that the slider value will be used.
    const hint = document.createElement('div');
    hint.style.cssText =
      'font-size: 10px; color: #888; margin: 4px 0 8px;';
    hint.textContent =
      'Saving uses the current "Trigger frame" value. Drag the slider above to set it.';
    this.form.appendChild(hint);

    this.addUpdateBtn = this.makeButton('Add / update trigger');
    this.addUpdateBtn.style.background = '#264f78';
    this.form.appendChild(this.addUpdateBtn);

    // Trigger list ------------------------------------------------------
    const listHeader = document.createElement('div');
    listHeader.textContent = 'Triggers on this animation';
    listHeader.style.cssText =
      'font-size: 11px; color: #aaa; margin: 12px 0 4px;';
    this.form.appendChild(listHeader);
    this.triggerList = document.createElement('div');
    this.triggerList.style.cssText =
      'font-family: monospace; font-size: 11px; color: #c0c0c0; line-height: 1.4;';
    this.form.appendChild(this.triggerList);

    // Save / reset / status --------------------------------------------
    const actionDivider = document.createElement('hr');
    actionDivider.style.cssText =
      'border: none; border-top: 1px solid #2a2a2a; margin: 16px 0 12px;';
    this.root.appendChild(actionDivider);

    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display: flex; gap: 8px;';
    this.resetAllBtn = this.makeButton('Reset all');
    this.saveBtn = this.makeButton('Save to disk');
    this.saveBtn.style.background = '#264f78';
    actionsRow.appendChild(this.resetAllBtn);
    actionsRow.appendChild(this.saveBtn);
    this.root.appendChild(actionsRow);

    this.statusLine = document.createElement('div');
    this.statusLine.style.cssText =
      'font-size: 11px; color: #888; margin-top: 8px; min-height: 14px;';
    this.root.appendChild(this.statusLine);

    parent.appendChild(this.root);
    this.wireEvents();
  }

  setListings(listings: ReadonlyArray<AnimationListing>): void {
    this.listingByKey = new Map(listings.map((l) => [l.fullKey, l]));
  }

  setSoundDefinitions(
    defs: ReadonlyArray<readonly [string, SoundDefinition]>,
  ): void {
    // Populate the <select> once. Decoded durations come in asynchronously
    // via setSoundDuration as the AudioLoader finishes decoding each id.
    this.soundSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— pick a sound —';
    this.soundSelect.appendChild(placeholder);
    for (const [id] of defs) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      this.soundSelect.appendChild(opt);
    }
  }

  setSoundDuration(soundId: string, durationMs: number): void {
    this.soundDurationsMs.set(soundId, durationMs);
    if (this.currentState?.selectedSoundId === soundId) {
      this.refreshSoundDurationLabel();
    }
  }

  setDefaultFps(fps: number): void {
    this.defaultFps = fps;
  }

  setStatus(text: string, isError = false): void {
    this.statusLine.textContent = text;
    this.statusLine.style.color = isError ? '#f48771' : '#888';
  }

  render(state: AlignerState): void {
    this.currentState = state;
    const selected = state.selectedAnimKey
      ? this.listingByKey.get(state.selectedAnimKey) ?? null
      : null;

    if (!selected) {
      this.emptyHint.style.display = 'block';
      this.form.style.display = 'none';
      return;
    }
    this.emptyHint.style.display = 'none';
    this.form.style.display = 'block';

    this.selectedLabel.textContent = selected.fullKey;
    const frameCount = selected.anim.frames.frameCount;
    this.animMetaLabel.textContent = `${frameCount} frames @ ${this.defaultFps} fps · ${(
      (frameCount * 1000) /
      this.defaultFps
    ).toFixed(0)} ms`;

    this.soundSelect.value = state.selectedSoundId ?? '';
    this.refreshSoundDurationLabel();

    this.playPauseBtn.textContent = state.playing ? 'Pause' : 'Play';
    this.currentFrameLabel.textContent =
      state.currentFrameIndex >= 1
        ? `frame ${state.currentFrameIndex} / ${frameCount}`
        : `— / ${frameCount}`;

    // Clamp the offset slider's extent to the anim length so the user can't
    // drag offscreen for a 5-frame anim. Min keeps a small buffer past 0 so
    // negative offsets are still discoverable.
    const offsetMax = Math.max(5, frameCount);
    const offsetMin = -offsetMax;
    this.offsetRange.min = String(offsetMin);
    this.offsetRange.max = String(offsetMax);
    this.offsetNumber.min = String(offsetMin);
    this.offsetNumber.max = String(offsetMax);
    this.offsetRange.value = String(state.audioOffsetFrames);
    this.offsetNumber.value = String(state.audioOffsetFrames);

    this.renderTriggerList(state, selected);
  }

  private refreshSoundDurationLabel(): void {
    const id = this.currentState?.selectedSoundId;
    if (!id) {
      this.soundDurationLabel.textContent = '';
      return;
    }
    const dur = this.soundDurationsMs.get(id);
    this.soundDurationLabel.textContent =
      dur === undefined ? 'Decoding…' : `${dur.toFixed(0)} ms`;
  }

  private renderTriggerList(
    state: AlignerState,
    selected: AnimationListing,
  ): void {
    const triggers = state.triggersByAnim.get(selected.fullKey) ?? [];
    this.triggerList.innerHTML = '';
    if (triggers.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = '#666';
      empty.textContent = 'No triggers yet.';
      this.triggerList.appendChild(empty);
      return;
    }
    for (const trig of triggers) {
      const row = document.createElement('div');
      row.style.cssText =
        'display: flex; align-items: center; gap: 6px; padding: 2px 0;';
      const text = document.createElement('span');
      text.style.flex = '1';
      text.style.cursor = 'pointer';
      text.style.textDecoration = 'underline dotted #555';
      text.title = 'Click to load into editor';
      const offsetSuffix =
        trig.audioStartOffsetMs && trig.audioStartOffsetMs > 0
          ? ` +${trig.audioStartOffsetMs.toFixed(0)}ms`
          : '';
      text.textContent = `${trig.name} @ frame ${trig.frameIndex}${offsetSuffix} (${trig.soundId})`;
      text.addEventListener('click', () => {
        this.triggerNameInput.value = trig.name;
        this.callbacks.onEditTrigger(
          trig.name,
          trig.soundId,
          trig.frameIndex,
          trig.audioStartOffsetMs ?? 0,
        );
      });
      row.appendChild(text);
      const rmBtn = this.makeSmallButton('×');
      rmBtn.style.minWidth = '24px';
      rmBtn.style.color = '#f48771';
      rmBtn.addEventListener('click', () => {
        this.callbacks.onRemoveTrigger(trig.name);
      });
      row.appendChild(rmBtn);
      this.triggerList.appendChild(row);
    }
  }

  private wireEvents(): void {
    this.soundSelect.addEventListener('change', () => {
      const v = this.soundSelect.value;
      this.callbacks.onSelectSound(v === '' ? null : v);
    });

    this.playPauseBtn.addEventListener('click', () => {
      this.callbacks.onTogglePlay();
    });
    this.stepBackBtn.addEventListener('click', () => {
      this.callbacks.onStepFrame(-1);
    });
    this.stepFwdBtn.addEventListener('click', () => {
      this.callbacks.onStepFrame(1);
    });

    const onOffset = (raw: string) => {
      const value = parseInt(raw, 10);
      if (Number.isNaN(value)) return;
      this.callbacks.onAudioOffsetChange(value);
    };
    this.offsetRange.addEventListener('input', () =>
      onOffset(this.offsetRange.value),
    );
    this.offsetNumber.addEventListener('change', () =>
      onOffset(this.offsetNumber.value),
    );

    this.addUpdateBtn.addEventListener('click', () => {
      const name = this.triggerNameInput.value.trim();
      if (!TRIGGER_NAME_REGEX.test(name)) {
        this.setStatus(
          'Trigger name must match /^[A-Za-z0-9_]+$/.',
          true,
        );
        return;
      }
      const sliderValue = this.currentState?.audioOffsetFrames ?? 0;
      if (!Number.isInteger(sliderValue)) {
        this.setStatus(
          'Trigger frame must be an integer.',
          true,
        );
        return;
      }
      const soundId = this.currentState?.selectedSoundId;
      if (!soundId) {
        this.setStatus('Pick a sound before authoring a trigger.', true);
        return;
      }
      // The slider's value answers "at which animation frame does audio
      // sample 0 sit?". When slider >= 1 the trigger simply fires at that
      // frame with a clean audio start. When slider < 1, sample 0 is
      // earlier than frame 1, which we represent at runtime by firing at
      // frame 1 and seeking into the buffer — that's audioStartOffsetMs.
      const fps = this.defaultFps;
      const frameIndex = sliderValue >= 1 ? sliderValue : 1;
      const audioStartOffsetMs =
        sliderValue >= 1 ? 0 : ((1 - sliderValue) * 1000) / fps;
      this.callbacks.onAddOrUpdateTrigger(
        name,
        soundId,
        frameIndex,
        audioStartOffsetMs,
      );
      const offsetSuffix =
        audioStartOffsetMs > 0
          ? ` (cut ${audioStartOffsetMs.toFixed(0)} ms into audio)`
          : '';
      this.setStatus(
        `Trigger "${name}" @ frame ${frameIndex}${offsetSuffix} updated.`,
      );
      this.triggerNameInput.value = '';
    });

    this.resetAllBtn.addEventListener('click', () => {
      this.callbacks.onResetAll();
    });
    this.saveBtn.addEventListener('click', () => {
      this.callbacks.onSave();
    });
  }

  private makeButton(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = [
      'flex: 1',
      'padding: 6px 8px',
      'background: #1e1e1e',
      'color: #ddd',
      'border: 1px solid #333',
      'cursor: pointer',
      'font-size: 12px',
    ].join(';');
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#2a2a2a';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#1e1e1e';
    });
    return btn;
  }

  private makeSmallButton(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = [
      'padding: 3px 8px',
      'background: #1e1e1e',
      'color: #ddd',
      'border: 1px solid #333',
      'cursor: pointer',
      'font-size: 11px',
    ].join(';');
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#2a2a2a';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#1e1e1e';
    });
    return btn;
  }

  private makeNumberSliderRow(label: string): {
    row: HTMLDivElement;
    range: HTMLInputElement;
    number: HTMLInputElement;
  } {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 10px;';
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText =
      'display: block; font-size: 11px; color: #aaa; margin-bottom: 4px;';
    row.appendChild(labelEl);
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    const range = document.createElement('input');
    range.type = 'range';
    range.style.flex = '1';
    const number = document.createElement('input');
    number.type = 'number';
    number.style.cssText = [
      'width: 64px',
      'background: #1e1e1e',
      'color: #ddd',
      'border: 1px solid #333',
      'padding: 2px 4px',
      'font-family: monospace',
    ].join(';');
    range.addEventListener('input', () => {
      number.value = range.value;
    });
    number.addEventListener('change', () => {
      range.value = number.value;
    });
    controls.appendChild(range);
    controls.appendChild(number);
    row.appendChild(controls);
    return { row, range, number };
  }
}
