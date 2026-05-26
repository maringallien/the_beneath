import Phaser from 'phaser';
import { listAnimations } from '../../src/sprites/characterLoader';
import { listEntityRegistryEntries } from '../../src/entities/entityRegistryLoader';
import { PreviewScene, type EntityBodyDefault } from './PreviewScene';
import { EditPanel } from './EditPanel';
import { AnimationList } from './AnimationList';
import { buildAttackBindings, hitboxFramesForAnimation } from './attackBindings';
import { FrameStrip } from './FrameStrip';
import {
  addNewAttack,
  applyAnchorsToUnset,
  clearAttackEdit,
  clearEdit,
  copyScaleToRegistry,
  INITIAL_STATE,
  patchAttackEdit,
  patchBodyEdit,
  patchEdit,
  patchNewAttack,
  removeNewAttack,
  setSelected,
  type AnimationEdit,
  type HitboxEdit,
  type ResizerState,
} from './state';
import { saveEdits } from './persist';

const CONTAINER_ID = 'anim-resizer-canvas';
const ZOOM_INPUT_ID = 'anim-resizer-zoom';
const LIST_WIDTH = 280;
const PANEL_WIDTH = 320;
const HEADER_HEIGHT = 41;
const ZOOM_BAR_HEIGHT = 32;
const FRAME_STRIP_HEIGHT = 48;
const DEFAULT_ZOOM = 6;
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

function bootstrap(): void {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) {
    throw new Error(`Missing container element #${CONTAINER_ID}`);
  }

  const listings = listAnimations();
  // Build the per-identifier physicsBody defaults map. Used by both the
  // EditPanel (to seed inputs + show pending diffs) and the PreviewScene
  // (to draw the actual body rect).
  const bodyDefaults = new Map<string, EntityBodyDefault>();
  for (const { identifier, config } of listEntityRegistryEntries()) {
    bodyDefaults.set(identifier, {
      width: config.physicsBody.width,
      height: config.physicsBody.height,
    });
  }
  // Index of (entity-animation fullKey → which attacks use it as a strike
  // clip). Drives the hitbox overlay + edit UI. Built once at boot.
  const attackBindings = buildAttackBindings();
  // Default selection so the canvas isn't empty on first load.
  const initialSelectedKey = listings[0]?.fullKey ?? null;

  let state: ResizerState = {
    edits: INITIAL_STATE.edits,
    bodyEdits: INITIAL_STATE.bodyEdits,
    attackEdits: INITIAL_STATE.attackEdits,
    newAttackEdits: INITIAL_STATE.newAttackEdits,
    selectedKey: initialSelectedKey,
  };

  const setState = (next: ResizerState) => {
    if (next === state) return;
    const prevSelected = state.selectedKey;
    state = next;
    panel.render(state);
    list.render(state);
    if (sceneInstance) sceneInstance.applyState(state);
    // Selection changes flip the frame strip to a different animation —
    // reset the cached current frame so the scrub head jumps back to 0.
    if (prevSelected !== state.selectedKey) currentFrameIndex = 0;
    drawFrameStrip();
  };

  const list = new AnimationList(document.body, {
    onSelect: (fullKey) => {
      setState(setSelected(state, fullKey));
    },
  });
  list.setListings(listings);

  const panel = new EditPanel(document.body, {
    onPatch: (fullKey, patch) => {
      setState(patchEdit(state, fullKey, patch));
    },
    onPatchBody: (identifier, patch) => {
      setState(patchBodyEdit(state, identifier, patch));
    },
    onResetAnimation: (fullKey) => {
      setState(clearEdit(state, fullKey));
    },
    onCopyScaleToRegistry: (registryId, scale) => {
      setState(copyScaleToRegistry(state, registryId, listings, scale));
    },
    onApplyAnchorsToUnset: (registryId, anchorX, anchorY) => {
      setState(applyAnchorsToUnset(state, registryId, listings, anchorX, anchorY));
    },
    onResetAll: () => {
      setState({
        edits: new Map(),
        bodyEdits: new Map(),
        attackEdits: new Map(),
        newAttackEdits: new Map(),
        selectedKey: state.selectedKey,
      });
    },
    onPatchHitbox: (identifier, attackIndex, hitboxIndex, patch) => {
      setState(patchAttackEdit(state, identifier, attackIndex, hitboxIndex, patch));
    },
    onResetHitbox: (identifier, attackIndex, hitboxIndex) => {
      setState(clearAttackEdit(state, identifier, attackIndex, hitboxIndex));
    },
    getCurrentFrame: () => sceneInstance?.getCurrentFrameIndex() ?? 0,
    onAddHitbox: (identifier, attackIndex, frame) => {
      // hitboxIndex for a newly created hitbox = (authored count) + (existing
      // pending creates on this attack). Compute it once at click time so the
      // edit goes into a stable slot in attackEdits.
      const binding = attackBindings.get(state.selectedKey ?? '')?.find(
        (b) => b.identifier === identifier && b.attackIndex === attackIndex,
      );
      const baseLen = binding?.hitboxes.length ?? 0;
      let pendingCreates = 0;
      for (const [key, edit] of state.attackEdits) {
        const parts = key.split(':');
        if (parts[0] === identifier && Number(parts[1]) === attackIndex && edit.create) {
          pendingCreates++;
        }
      }
      const hitboxIndex = baseLen + pendingCreates;
      setState(
        patchAttackEdit(state, identifier, attackIndex, hitboxIndex, {
          create: true,
          offsetX: 0,
          offsetY: 0,
          width: 30,
          height: 20,
          frame,
        }),
      );
    },
    onRemoveHitbox: (identifier, attackIndex, hitboxIndex) => {
      // Flag the slot as deleted. The server discards the underlying hitbox
      // on save; until then the row is rendered with a "(pending delete)"
      // badge so the user can undo via reset.
      setState(
        patchAttackEdit(state, identifier, attackIndex, hitboxIndex, { delete: true }),
      );
    },
    onCreateNewAttack: (identifier, animation, frame) => {
      // Spawns a pending new-attack with default geometry on the current
      // frame. The user can drag/resize its hitbox; on save, the server
      // appends a full melee attack to behavior.attackPool.
      const { state: nextState } = addNewAttack(state, identifier, animation, frame);
      setState(nextState);
      // Pause and scrub to the chosen frame so the new hitbox is on-screen
      // right away. Without this, if the animation was playing when the
      // button was clicked, the sprite would already have advanced past
      // `frame` by the time the overlay redraws and the hitbox would be
      // invisible until the user scrubbed back.
      sceneInstance?.scrubToFrame(frame);
    },
    onPatchNewAttackHitbox: (identifier, tempId, patch) => {
      setState(patchNewAttack(state, identifier, tempId, patch));
    },
    onRemoveNewAttack: (identifier, tempId) => {
      setState(removeNewAttack(state, identifier, tempId));
    },
    onSave: () => {
      void (async () => {
        if (
          state.edits.size === 0 &&
          state.bodyEdits.size === 0 &&
          state.attackEdits.size === 0 &&
          state.newAttackEdits.size === 0
        ) {
          panel.setStatus('Nothing to save.');
          return;
        }
        panel.setStatus('Saving…');
        const result = await saveEdits(state, listings);
        if (result.ok) {
          const mode =
            result.mode === 'download'
              ? 'downloaded — drop into src/sprites/'
              : 'wrote files';
          panel.setStatus(
            `Saved ${result.written.length} registry/registries (${mode}).`,
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
  panel.setBodyDefaults(bodyDefaults);
  panel.setAttackBindings(attackBindings);

  // Style the canvas region so it sits between the list and panel, leaving
  // room for the zoom bar at the top and the frame strip at the bottom.
  const centerLeft = LIST_WIDTH;
  const centerWidth = window.innerWidth - LIST_WIDTH - PANEL_WIDTH;
  const centerHeight =
    window.innerHeight - HEADER_HEIGHT - ZOOM_BAR_HEIGHT - FRAME_STRIP_HEIGHT;
  container.style.cssText = [
    'position: fixed',
    `top: ${HEADER_HEIGHT + ZOOM_BAR_HEIGHT}px`,
    `left: ${centerLeft}px`,
    `width: ${centerWidth}px`,
    `height: ${centerHeight}px`,
    'background: #1e1e1e',
    'overflow: hidden',
  ].join(';');

  // Zoom bar above the canvas.
  const zoomBar = document.createElement('div');
  zoomBar.style.cssText = [
    'position: fixed',
    `top: ${HEADER_HEIGHT}px`,
    `left: ${LIST_WIDTH}px`,
    `width: ${centerWidth}px`,
    `height: ${ZOOM_BAR_HEIGHT}px`,
    'background: #0d0d0d',
    'border-bottom: 1px solid #2a2a2a',
    'display: flex',
    'align-items: center',
    'gap: 8px',
    'padding: 0 12px',
    'box-sizing: border-box',
    'color: #aaa',
    'font-family: -apple-system, BlinkMacSystemFont, sans-serif',
    'font-size: 12px',
    'z-index: 4',
  ].join(';');
  zoomBar.innerHTML = `
    <span>Preview zoom</span>
    <input id="${ZOOM_INPUT_ID}" type="range" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.5" value="${DEFAULT_ZOOM}" style="flex:1;max-width:240px"/>
    <span id="${ZOOM_INPUT_ID}-label" style="font-family:monospace">${DEFAULT_ZOOM.toFixed(1)}×</span>
    <button id="anim-resizer-step-prev" title="Previous frame" style="background:#1e1e1e;color:#ddd;border:1px solid #333;padding:2px 8px;cursor:pointer;font-family:monospace;">‹</button>
    <button id="anim-resizer-pause" title="Pause/play (Space)" style="background:#1e1e1e;color:#ddd;border:1px solid #333;padding:2px 10px;cursor:pointer;">▶︎</button>
    <button id="anim-resizer-step-next" title="Next frame" style="background:#1e1e1e;color:#ddd;border:1px solid #333;padding:2px 8px;cursor:pointer;font-family:monospace;">›</button>
  `;
  document.body.appendChild(zoomBar);

  let sceneInstance: PreviewScene | null = null;
  // Cached so the FrameStrip's hitbox-frame highlight updates the moment
  // the selected animation changes — drawFrameStrip() pulls from this.
  let currentFrameIndex = 0;

  // Mount the frame strip at the bottom of the canvas region. Placed in a
  // host div so absolute positioning matches the canvas's coordinate space
  // and resizing follows the same width as the preview.
  const frameStripHost = document.createElement('div');
  frameStripHost.style.cssText = [
    'position: fixed',
    `top: ${HEADER_HEIGHT + ZOOM_BAR_HEIGHT + centerHeight}px`,
    `left: ${centerLeft}px`,
    `width: ${centerWidth}px`,
    `height: ${FRAME_STRIP_HEIGHT}px`,
    'background: #141414',
    'border-top: 1px solid #2a2a2a',
    'z-index: 3',
  ].join(';');
  document.body.appendChild(frameStripHost);
  const frameStrip = new FrameStrip(frameStripHost, {
    onScrubTo: (frame) => {
      sceneInstance?.scrubToFrame(frame);
      // scrubToFrame fires onFrameChange which redraws the strip; no need
      // to call drawFrameStrip here explicitly.
    },
  });
  frameStrip.resize(centerWidth, FRAME_STRIP_HEIGHT);

  const drawFrameStrip = () => {
    const fullKey = state.selectedKey;
    if (!fullKey) {
      frameStrip.clear();
      return;
    }
    const listing = listings.find((l) => l.fullKey === fullKey);
    if (!listing) {
      frameStrip.clear();
      return;
    }
    frameStrip.draw({
      frameCount: listing.anim.frames.frameCount,
      currentFrameIndex,
      hitboxFrames: hitboxFramesForAnimation(attackBindings, fullKey),
    });
  };

  const scene = new PreviewScene({
    width: centerWidth,
    height: centerHeight,
    initialZoom: DEFAULT_ZOOM,
    onReady: () => {
      sceneInstance = scene;
      scene.setListings(listings);
      scene.setBodyDefaults(bodyDefaults);
      scene.setAttackBindings(attackBindings);
      scene.applyState(state);
      drawFrameStrip();
    },
    callbacks: {
      onAnchorDrag: (fullKey, patch: AnimationEdit) => {
        setState(patchEdit(state, fullKey, patch));
      },
      onHitboxDrag: (identifier, attackIndex, hitboxIndex, patch: HitboxEdit) => {
        setState(patchAttackEdit(state, identifier, attackIndex, hitboxIndex, patch));
      },
      onNewAttackHitboxDrag: (identifier, tempId, patch) => {
        setState(patchNewAttack(state, identifier, tempId, patch));
      },
      onFrameChange: (frameIndex) => {
        currentFrameIndex = frameIndex;
        drawFrameStrip();
      },
    },
  });

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: CONTAINER_ID,
    width: centerWidth,
    height: centerHeight,
    backgroundColor: '#1e1e1e',
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    render: {
      pixelArt: true,
      antialias: false,
    },
    scene: [scene],
  });

  const zoomInput = document.getElementById(ZOOM_INPUT_ID) as HTMLInputElement;
  const zoomLabel = document.getElementById(`${ZOOM_INPUT_ID}-label`);
  zoomInput.addEventListener('input', () => {
    const zoom = parseFloat(zoomInput.value);
    if (Number.isFinite(zoom) && zoom > 0) {
      sceneInstance?.setZoom(zoom);
      if (zoomLabel) zoomLabel.textContent = `${zoom.toFixed(1)}×`;
    }
  });

  const pauseBtn = document.getElementById('anim-resizer-pause') as HTMLButtonElement | null;
  const stepPrevBtn = document.getElementById('anim-resizer-step-prev') as HTMLButtonElement | null;
  const stepNextBtn = document.getElementById('anim-resizer-step-next') as HTMLButtonElement | null;
  const refreshPauseLabel = () => {
    if (pauseBtn) pauseBtn.textContent = sceneInstance?.isPaused() ? '⏸' : '▶︎';
  };
  pauseBtn?.addEventListener('click', () => {
    sceneInstance?.togglePaused();
    refreshPauseLabel();
  });
  stepPrevBtn?.addEventListener('click', () => {
    sceneInstance?.stepFrame(-1);
    refreshPauseLabel();
  });
  stepNextBtn?.addEventListener('click', () => {
    sceneInstance?.stepFrame(1);
    refreshPauseLabel();
  });
  // Keyboard shortcuts: Space toggles pause, ←/→ step frames. Skip when the
  // focus is on a form input so the user can still type in number boxes.
  document.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      sceneInstance?.togglePaused();
      refreshPauseLabel();
    } else if (ev.code === 'ArrowLeft') {
      ev.preventDefault();
      sceneInstance?.stepFrame(-1);
      refreshPauseLabel();
    } else if (ev.code === 'ArrowRight') {
      ev.preventDefault();
      sceneInstance?.stepFrame(1);
      refreshPauseLabel();
    }
  });

  panel.render(state);
  list.render(state);
  drawFrameStrip();
}

bootstrap();
