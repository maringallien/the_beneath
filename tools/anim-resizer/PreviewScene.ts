import Phaser from 'phaser';
import {
  DEFAULT_CHARACTER_FPS,
  gunOverlayAnimKey,
  preloadAllCharacters,
  preloadAllEntities,
  registerAllCharacterAnimations,
  registerAllEntityAnimations,
  type AnimationListing,
} from '../../src/sprites/characterLoader';
import {
  GUN_OVERLAY_GRIP_ORIGIN_X,
  GUN_OVERLAY_PIVOT_OFFSET_X,
  GUN_OVERLAY_PIVOT_OFFSET_Y,
} from '../../src/constants';
import {
  parseNewAttackEditKey,
  resolveHitboxGeometry,
  resolveValues,
  type AnimationEdit,
  type HitboxEdit,
  type NewAttackEdit,
  type ResizerState,
} from './state';
import type {
  AttackBindingsMap,
  NormalizedHitbox,
} from './attackBindings';

// Fallback body size used for player listings (no per-entity physicsBody).
// Entity listings use the registry's physicsBody, with any pending body
// edit applied on top.
const PHYSICS_BODY_WIDTH = 16;
const PHYSICS_BODY_HEIGHT = 24;

export interface EntityBodyDefault {
  readonly width: number;
  readonly height: number;
}

const BODY_BOX_COLOR = 0xff3355;
const ANCHOR_HANDLE_SIZE = 8;
const ANCHOR_HANDLE_COLOR = 0x66ff99;
const HITBOX_FILL_COLOR = 0xffaa22;
const HITBOX_STROKE_COLOR = 0xffd166;
const HITBOX_FILL_ALPHA = 0.18;
const HITBOX_MATCHBODY_COLOR = 0xff99cc;
const HITBOX_HANDLE_SIZE = 8;
const HITBOX_HANDLE_COLOR = 0xffffff;

// Corner-handle roles; the drag handler reads this off setData('role') to
// dispatch to the right resize math (each role anchors the *opposite*
// corner).
type HitboxHandleRole = 'tl' | 'tr' | 'bl' | 'br';

interface HitboxView {
  readonly attackIndex: number;
  readonly hitboxIndex: number;
  readonly body: Phaser.GameObjects.Rectangle;
  readonly handles: Record<HitboxHandleRole, Phaser.GameObjects.Rectangle>;
}

// World origin = (0,0) is the sprite's logical center. The camera is
// centered there and zoomed; the canvas drawable region just shows the
// area around the origin.
const SPRITE_CENTER_X = 0;
const SPRITE_CENTER_Y = 0;

const COMPOSITE_BODY_MODE = 'gunslinger_body';
const COMPOSITE_GUN_MODE: 'gunslinger_gun1' | 'gunslinger_gun2' =
  'gunslinger_gun1';

export interface PreviewSceneCallbacks {
  readonly onAnchorDrag: (fullKey: string, patch: AnimationEdit) => void;
  readonly onHitboxDrag: (
    identifier: string,
    attackIndex: number,
    hitboxIndex: number,
    patch: HitboxEdit,
  ) => void;
  // Drag handler for the hitbox of a brand-new (not-yet-saved) attack. The
  // tempId references the entry in ResizerState.newAttackEdits.
  readonly onNewAttackHitboxDrag: (
    identifier: string,
    tempId: string,
    patch: Partial<NewAttackEdit>,
  ) => void;
  // Fires whenever the visible sprite frame changes (live playback step,
  // scrub, or step-frame). 0-based to match the registry's hitbox.frame
  // convention. Used by main.ts to keep the frame strip's scrub head in
  // sync with what's shown on the canvas.
  readonly onFrameChange?: (frameIndexZeroBased: number) => void;
}

export interface PreviewSceneOptions {
  readonly callbacks: PreviewSceneCallbacks;
  readonly width: number;
  readonly height: number;
  readonly initialZoom: number;
  readonly onReady?: () => void;
}

export class PreviewScene extends Phaser.Scene {
  private readonly callbacks: PreviewSceneCallbacks;
  private readonly initialZoom: number;
  private readonly onReady?: () => void;

  private currentListing: AnimationListing | null = null;
  private currentState: ResizerState | null = null;

  private sprite: Phaser.GameObjects.Sprite | null = null;
  private gunOverlay: Phaser.GameObjects.Sprite | null = null;
  private bodyBox: Phaser.GameObjects.Graphics | null = null;
  private anchorHandle: Phaser.GameObjects.Rectangle | null = null;
  private gridGraphics: Phaser.GameObjects.Graphics | null = null;
  private hitboxOverlay: Phaser.GameObjects.Graphics | null = null;
  // Pool of interactive hitbox views, keyed by `${attackIndex}:${hitboxIndex}`.
  // matchBody hitboxes don't get a view — they render via hitboxOverlay
  // (Graphics) as a dashed read-only outline. The pool reuses views across
  // frame updates to avoid create/destroy churn on every ANIMATION_UPDATE.
  private hitboxViews: Map<string, HitboxView> = new Map();
  private listingByKey: Map<string, AnimationListing> = new Map();
  private bodyDefaults: Map<string, EntityBodyDefault> = new Map();
  private attackBindings: AttackBindingsMap = new Map();
  // Paused-step state: when paused, the animation is held on a frame index
  // (0-based) and the user can advance frame-by-frame. Needed so multi-frame
  // hitboxes can be inspected without the looping animation flashing them
  // on/off as it advances.
  private paused = false;
  private pausedFrameIndex = 0;

  constructor(opts: PreviewSceneOptions) {
    super('PreviewScene');
    this.callbacks = opts.callbacks;
    this.initialZoom = opts.initialZoom;
    this.onReady = opts.onReady;
  }

  preload(): void {
    preloadAllCharacters(this);
    preloadAllEntities(this);
  }

  create(): void {
    registerAllCharacterAnimations(this, { defaultFps: DEFAULT_CHARACTER_FPS });
    registerAllEntityAnimations(this, { defaultFps: DEFAULT_CHARACTER_FPS });
    this.cameras.main.setBackgroundColor('#1e1e1e');
    this.cameras.main.centerOn(SPRITE_CENTER_X, SPRITE_CENTER_Y);
    this.cameras.main.setZoom(this.initialZoom);

    this.gridGraphics = this.add.graphics();
    this.gridGraphics.setDepth(0);
    this.drawCheckerboard();

    this.bodyBox = this.add.graphics();
    this.bodyBox.setDepth(4);

    this.hitboxOverlay = this.add.graphics();
    this.hitboxOverlay.setDepth(4);

    const handle = this.add
      .rectangle(
        0,
        0,
        ANCHOR_HANDLE_SIZE,
        ANCHOR_HANDLE_SIZE,
        ANCHOR_HANDLE_COLOR,
        0.7,
      )
      .setStrokeStyle(1, 0x000000, 0.9)
      .setInteractive({ draggable: true, cursor: 'grab' });
    this.input.setDraggable(handle);
    handle.setDepth(5);
    handle.setVisible(false);
    this.anchorHandle = handle;

    this.input.on(Phaser.Input.Events.DRAG, this.onDrag, this);
    this.onReady?.();
  }

  setListings(listings: ReadonlyArray<AnimationListing>): void {
    this.listingByKey = new Map(listings.map((l) => [l.fullKey, l]));
  }

  setBodyDefaults(defaults: ReadonlyMap<string, EntityBodyDefault>): void {
    this.bodyDefaults = new Map(defaults);
    // Re-render so a body resize from elsewhere reflects immediately.
    if (this.currentState) this.applyState(this.currentState);
  }

  setAttackBindings(bindings: AttackBindingsMap): void {
    this.attackBindings = bindings;
    // The set of overlayed hitboxes for the current animation may change
    // when bindings load; re-render so the overlay reflects them.
    if (this.currentState) this.applyState(this.currentState);
  }

  // Pause-step controls used by the toolbar. Toggling pause holds the sprite
  // on its current frame; step advances by one frame. Step wraps so the user
  // can cycle through the multi-frame animation while inspecting hitboxes.
  togglePaused(): boolean {
    const sprite = this.sprite;
    if (!sprite) return this.paused;
    if (this.paused) {
      this.paused = false;
      // Resume the looping playback from the held frame.
      sprite.anims.resume();
    } else {
      this.paused = true;
      // Capture the current frame so step-by-step starts where playback
      // visibly left off, not where the next anim-update fired.
      this.pausedFrameIndex = Math.max(0, (sprite.anims.currentFrame?.index ?? 1) - 1);
      sprite.anims.pause();
      this.redrawHitboxOverlay();
    }
    return this.paused;
  }

  stepFrame(delta: number): void {
    const sprite = this.sprite;
    const listing = this.currentListing;
    if (!sprite || !listing) return;
    if (!this.paused) {
      // Step implies pause — capture position before advancing so the
      // user doesn't have to click pause first.
      this.paused = true;
      this.pausedFrameIndex = Math.max(0, (sprite.anims.currentFrame?.index ?? 1) - 1);
      sprite.anims.pause();
    }
    const frameCount = listing.anim.frames.frameCount;
    if (frameCount <= 0) return;
    const next = ((this.pausedFrameIndex + delta) % frameCount + frameCount) % frameCount;
    this.pausedFrameIndex = next;
    // Phaser frame indices are 1-based; setCurrentFrame uses the AnimationFrame
    // object directly. setFrame on the sprite expects the texture frame name,
    // which for spritesheets is the numeric index. Use anims.setCurrentFrame
    // by index for reliability across Phaser versions.
    const animFrames = sprite.anims.currentAnim?.frames;
    if (animFrames && animFrames[next]) {
      sprite.anims.setCurrentFrame(animFrames[next]);
    }
    this.redrawHitboxOverlay();
    this.callbacks.onFrameChange?.(next);
  }

  isPaused(): boolean {
    return this.paused;
  }

  // 0-based current frame index (Phaser stores 1-based internally; we
  // normalize here for consumers that compare against registry frame values).
  // Returns 0 when no sprite is active so the "add hitbox on this frame"
  // affordance still has a sensible default.
  getCurrentFrameIndex(): number {
    const sprite = this.sprite;
    if (!sprite) return 0;
    return Math.max(0, (sprite.anims.currentFrame?.index ?? 1) - 1);
  }

  setZoom(zoom: number): void {
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(SPRITE_CENTER_X, SPRITE_CENTER_Y);
    this.drawCheckerboard();
  }

  applyState(state: ResizerState): void {
    this.currentState = state;
    const fullKey = state.selectedKey;
    if (!fullKey) {
      this.currentListing = null;
      this.disposeSprite();
      this.bodyBox?.clear();
      this.hitboxOverlay?.clear();
      this.anchorHandle?.setVisible(false);
      return;
    }
    const listing = this.listingByKey.get(fullKey) ?? null;
    if (!listing) return;

    if (this.currentListing?.fullKey !== fullKey) {
      this.swapListing(listing);
    }
    this.applyValuesForCurrent(state.edits.get(fullKey));
  }

  private swapListing(listing: AnimationListing): void {
    this.disposeSprite();
    this.currentListing = listing;
    // Reset pause when switching animations — the previous animation's held
    // frame is meaningless on a new clip with a different frame count.
    this.paused = false;
    this.pausedFrameIndex = 0;
    this.destroyAllHitboxViews();
    const sprite = this.add.sprite(SPRITE_CENTER_X, SPRITE_CENTER_Y, listing.fullKey);
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(2);
    // Force-loop in the preview regardless of the registry's `loops` flag —
    // attacks/death/roll/etc. are one-shots in-game but should animate
    // continuously here so the user can size them across every frame.
    sprite.play({ key: listing.fullKey, repeat: -1 });
    // Frame-change subscription: each animation step triggers a hitbox
    // overlay redraw so per-frame hitboxes show/hide as the swing advances.
    sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, this.onAnimationUpdate, this);
    this.sprite = sprite;

    if (listing.mode === COMPOSITE_BODY_MODE) {
      const gunKey = gunOverlayAnimKey(COMPOSITE_GUN_MODE, 'idle');
      if (this.textures.exists(gunKey)) {
        const gun = this.add.sprite(SPRITE_CENTER_X, SPRITE_CENTER_Y, gunKey);
        gun.setOrigin(GUN_OVERLAY_GRIP_ORIGIN_X, 0.5);
        gun.setDepth(3);
        gun.play({ key: gunKey, repeat: -1 });
        this.gunOverlay = gun;
      }
    }
  }

  private onAnimationUpdate(): void {
    this.redrawHitboxOverlay();
    this.callbacks.onFrameChange?.(this.getCurrentFrameIndex());
  }

  // Click-target for the frame strip. Pauses playback, jumps to the given
  // 0-based frame, redraws the overlay. Idempotent — clicking the same
  // frame twice is a no-op beyond ensuring pause is on.
  scrubToFrame(frameIndexZeroBased: number): void {
    const sprite = this.sprite;
    const listing = this.currentListing;
    if (!sprite || !listing) return;
    const frameCount = listing.anim.frames.frameCount;
    if (frameCount <= 0) return;
    const clamped = Math.max(0, Math.min(frameCount - 1, Math.round(frameIndexZeroBased)));
    if (!this.paused) {
      this.paused = true;
      sprite.anims.pause();
    }
    this.pausedFrameIndex = clamped;
    const animFrames = sprite.anims.currentAnim?.frames;
    if (animFrames && animFrames[clamped]) {
      sprite.anims.setCurrentFrame(animFrames[clamped]);
    }
    this.redrawHitboxOverlay();
    this.callbacks.onFrameChange?.(clamped);
  }

  private disposeSprite(): void {
    if (this.sprite) {
      this.sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE, this.onAnimationUpdate, this);
      this.sprite.destroy();
    }
    this.sprite = null;
    this.gunOverlay?.destroy();
    this.gunOverlay = null;
  }

  private applyValuesForCurrent(edit: AnimationEdit | undefined): void {
    const listing = this.currentListing;
    const sprite = this.sprite;
    const bodyBox = this.bodyBox;
    const handle = this.anchorHandle;
    if (!listing || !sprite || !bodyBox || !handle) return;

    const { frameWidth, frameHeight } = listing.anim.frames;
    const resolved = resolveValues(listing, edit);
    const { displayScale, anchorX, anchorY } = resolved;

    sprite.setScale(displayScale);

    const anchorWorldX =
      SPRITE_CENTER_X + (anchorX - frameWidth / 2) * displayScale;
    const anchorWorldY =
      SPRITE_CENTER_Y + (anchorY - frameHeight / 2) * displayScale;

    // Body size: entity listings pull from the registry's physicsBody (with
    // any pending edit applied); player listings fall back to the constants.
    let bodyW = PHYSICS_BODY_WIDTH;
    let bodyH = PHYSICS_BODY_HEIGHT;
    const identifier = listing.entityIdentifier;
    if (identifier) {
      const defaults = this.bodyDefaults.get(identifier);
      const bodyEdit = this.currentState?.bodyEdits.get(identifier);
      if (defaults) {
        bodyW = bodyEdit?.width ?? defaults.width;
        bodyH = bodyEdit?.height ?? defaults.height;
      }
    }
    bodyBox.clear();
    bodyBox.lineStyle(1, BODY_BOX_COLOR, 1);
    bodyBox.strokeRect(
      anchorWorldX - bodyW / 2,
      anchorWorldY - bodyH,
      bodyW,
      bodyH,
    );

    if (this.gunOverlay) {
      this.gunOverlay.setPosition(
        SPRITE_CENTER_X + GUN_OVERLAY_PIVOT_OFFSET_X * displayScale,
        SPRITE_CENTER_Y + GUN_OVERLAY_PIVOT_OFFSET_Y * displayScale,
      );
    }

    handle.setPosition(anchorWorldX, anchorWorldY);
    handle.setVisible(true);

    this.redrawHitboxOverlay();
  }

  // Recomputes which hitboxes are visible on the current frame and updates
  // the interactive view pool + matchBody overlay. Called on initial render,
  // on every ANIMATION_UPDATE, on pause/step, and on state changes.
  private redrawHitboxOverlay(): void {
    const overlay = this.hitboxOverlay;
    const sprite = this.sprite;
    const listing = this.currentListing;
    if (!overlay) return;
    overlay.clear();
    if (!sprite || !listing) {
      this.destroyAllHitboxViews();
      return;
    }
    // bindings may be empty/undefined — that just means no authored attack
    // uses this animation. We still continue so pending new-attack hitboxes
    // for unbound animations get rendered.
    const bindings = this.attackBindings.get(listing.fullKey) ?? [];
    // Phaser anim frame index is 1-based; the registry's hitbox.frame is
    // 0-based. Normalize once so the comparison stays readable.
    const currentFrame0 = Math.max(0, (sprite.anims.currentFrame?.index ?? 1) - 1);
    const edit = this.currentState?.edits.get(listing.fullKey);
    const resolved = resolveValues(listing, edit);
    const { displayScale, anchorX, anchorY } = resolved;
    const { frameWidth, frameHeight } = listing.anim.frames;
    const anchorWorldX =
      SPRITE_CENTER_X + (anchorX - frameWidth / 2) * displayScale;
    const anchorWorldY =
      SPRITE_CENTER_Y + (anchorY - frameHeight / 2) * displayScale;
    // Body rect (matches what bodyBox draws). matchBody hitboxes overlay
    // this rect so the user sees the live damage zone.
    const identifier = listing.entityIdentifier;
    let bodyW = 0;
    let bodyH = 0;
    if (identifier) {
      const defaults = this.bodyDefaults.get(identifier);
      const bodyEdit = this.currentState?.bodyEdits.get(identifier);
      if (defaults) {
        bodyW = bodyEdit?.width ?? defaults.width;
        bodyH = bodyEdit?.height ?? defaults.height;
      }
    }

    const seenKeys = new Set<string>();
    for (const binding of bindings) {
      for (const hb of binding.hitboxes) {
        if (hb.frame !== currentFrame0) continue;
        const key = `${binding.attackIndex}:${hb.hitboxIndex}`;
        // Pending delete: skip the visual entirely so the user sees what
        // saving will produce.
        const pendingEdit = this.currentState?.attackEdits.get(
          `${binding.identifier}:${binding.attackIndex}:${hb.hitboxIndex}`,
        );
        if (pendingEdit?.delete) continue;
        if (hb.matchBody) {
          // matchBody is read-only — render the dashed outline on the body
          // rect; no interactive view, so it's deliberately not in
          // hitboxViews and won't get handles.
          this.drawDashedRect(
            overlay,
            anchorWorldX - bodyW / 2,
            anchorWorldY - bodyH,
            bodyW,
            bodyH,
            HITBOX_MATCHBODY_COLOR,
          );
          continue;
        }
        seenKeys.add(key);
        const geometry = this.resolveEffectiveHitbox(binding.identifier, binding.attackIndex, hb);
        this.updateHitboxView(
          binding.identifier,
          binding.attackIndex,
          hb.hitboxIndex,
          geometry,
          anchorWorldX,
        );
      }
    }

    // Pending creates: client-side new hitboxes that aren't in the binding
    // map yet. Render them as draggable rects on their stamped frame so the
    // user can position them before saving.
    if (this.currentState) {
      for (const [editKey, edit] of this.currentState.attackEdits) {
        if (!edit.create) continue;
        const parts = editKey.split(':');
        if (parts.length !== 3) continue;
        const editIdentifier = parts[0];
        const editAttackIndex = Number(parts[1]);
        const editHitboxIndex = Number(parts[2]);
        // Only render creates that belong to one of the bindings for the
        // current animation. Cross-animation creates are kept in state but
        // not visible in this frame's overlay.
        const matchingBinding = bindings.find(
          (b) => b.identifier === editIdentifier && b.attackIndex === editAttackIndex,
        );
        if (!matchingBinding) continue;
        const stampedFrame = edit.frame ?? 0;
        if (stampedFrame !== currentFrame0) continue;
        const viewKey = `${editAttackIndex}:${editHitboxIndex}`;
        seenKeys.add(viewKey);
        this.updateHitboxView(
          editIdentifier,
          editAttackIndex,
          editHitboxIndex,
          {
            offsetX: edit.offsetX ?? 0,
            offsetY: edit.offsetY ?? 0,
            width: edit.width ?? 30,
            height: edit.height ?? 20,
          },
          anchorWorldX,
        );
      }
    }

    // Pending new attacks: brand-new attacks the user is staging. Their
    // tempIds are independent of the binding map; render each on its
    // configured frame as a draggable rect using the same view pool keyed
    // under `new::${tempId}` so it can't collide with attackIndex-based keys.
    if (this.currentState && listing.entityIdentifier) {
      for (const [editKey, edit] of this.currentState.newAttackEdits) {
        const parsed = parseNewAttackEditKey(editKey);
        if (!parsed) continue;
        if (parsed.identifier !== listing.entityIdentifier) continue;
        if (edit.animation !== listing.anim.key) continue;
        if (edit.frame !== currentFrame0) continue;
        const viewKey = `new::${parsed.tempId}`;
        seenKeys.add(viewKey);
        this.updateNewAttackHitboxView(parsed.identifier, parsed.tempId, edit, anchorWorldX);
      }
    }

    // Tear down any views whose hitboxes are no longer visible on this frame
    // (e.g., user stepped past a multi-frame hitbox's window).
    for (const key of [...this.hitboxViews.keys()]) {
      if (!seenKeys.has(key)) this.destroyHitboxView(key);
    }
  }

  // Same shape as updateHitboxView but parameterized for a NewAttackEdit
  // (no attackIndex/hitboxIndex on the wire; uses tempId in setData).
  private updateNewAttackHitboxView(
    identifier: string,
    tempId: string,
    edit: NewAttackEdit,
    anchorWorldX: number,
  ): void {
    const viewKey = `new::${tempId}`;
    let view = this.hitboxViews.get(viewKey);
    if (!view) {
      view = this.createNewAttackHitboxView(identifier, tempId);
      this.hitboxViews.set(viewKey, view);
    }
    const left = anchorWorldX + edit.offsetX;
    const top = SPRITE_CENTER_Y + edit.offsetY - edit.height / 2;
    const cx = left + edit.width / 2;
    const cy = top + edit.height / 2;
    view.body.setSize(edit.width, edit.height);
    view.body.setPosition(cx, cy);
    view.body.input?.hitArea?.setSize?.(edit.width, edit.height);
    // New-attack rects get a different fill color (green tint) so they're
    // visually distinct from authored hitboxes.
    view.body.setFillStyle(0x66ff99, 0.22);
    view.body.setStrokeStyle(1, 0x99ff99, 0.95);
    const right = left + edit.width;
    const bottom = top + edit.height;
    const handlePositions: Record<HitboxHandleRole, { x: number; y: number }> = {
      tl: { x: left, y: top },
      tr: { x: right, y: top },
      bl: { x: left, y: bottom },
      br: { x: right, y: bottom },
    };
    for (const role of ['tl', 'tr', 'bl', 'br'] as const) {
      const handle = view.handles[role];
      const { x, y } = handlePositions[role];
      handle.setPosition(x, y);
      handle.setVisible(true);
    }
  }

  private createNewAttackHitboxView(identifier: string, tempId: string): HitboxView {
    const body = this.add
      .rectangle(0, 0, 1, 1, 0x66ff99, 0.22)
      .setStrokeStyle(1, 0x99ff99, 0.95)
      .setOrigin(0.5, 0.5)
      .setDepth(4)
      .setInteractive({ draggable: true, cursor: 'move' });
    body.setData('role', 'new-attack-body');
    body.setData('identifier', identifier);
    body.setData('tempId', tempId);
    this.input.setDraggable(body);

    const makeHandle = (role: HitboxHandleRole, cursor: string) => {
      const handle = this.add
        .rectangle(0, 0, HITBOX_HANDLE_SIZE, HITBOX_HANDLE_SIZE, HITBOX_HANDLE_COLOR, 0.95)
        .setStrokeStyle(1, 0x000000, 0.9)
        .setOrigin(0.5, 0.5)
        .setDepth(6)
        .setInteractive({ draggable: true, cursor });
      handle.setData('role', `new-attack-handle-${role}`);
      handle.setData('identifier', identifier);
      handle.setData('tempId', tempId);
      handle.setVisible(false);
      this.input.setDraggable(handle);
      return handle;
    };
    const handles: Record<HitboxHandleRole, Phaser.GameObjects.Rectangle> = {
      tl: makeHandle('tl', 'nwse-resize'),
      tr: makeHandle('tr', 'nesw-resize'),
      bl: makeHandle('bl', 'nesw-resize'),
      br: makeHandle('br', 'nwse-resize'),
    };
    // New-attack views still use the HitboxView shape (with attackIndex /
    // hitboxIndex fields) so the destroy pool can wipe them uniformly.
    // Stuffing -1/-1 is just a placeholder — the keys are tempId-based.
    return { attackIndex: -1, hitboxIndex: -1, body, handles };
  }

  // Resolves the effective (offsetX, offsetY, width, height) for a hitbox by
  // merging any pending edit on top of the authored values. Centralized so
  // every consumer (overlay draw, drag math) reads the same source.
  private resolveEffectiveHitbox(
    identifier: string,
    attackIndex: number,
    hb: NormalizedHitbox,
  ): { offsetX: number; offsetY: number; width: number; height: number } {
    const edits = this.currentState?.attackEdits;
    if (!edits) {
      return { offsetX: hb.offsetX, offsetY: hb.offsetY, width: hb.width, height: hb.height };
    }
    return resolveHitboxGeometry(
      identifier,
      attackIndex,
      hb.hitboxIndex,
      { offsetX: hb.offsetX, offsetY: hb.offsetY, width: hb.width, height: hb.height },
      edits,
    );
  }

  private updateHitboxView(
    identifier: string,
    attackIndex: number,
    hitboxIndex: number,
    geometry: { offsetX: number; offsetY: number; width: number; height: number },
    anchorWorldX: number,
  ): void {
    const key = `${attackIndex}:${hitboxIndex}`;
    let view = this.hitboxViews.get(key);
    if (!view) {
      view = this.createHitboxView(identifier, attackIndex, hitboxIndex);
      this.hitboxViews.set(key, view);
    }
    // Position + size the body rect. Origin is (0.5, 0.5) so x/y = center.
    const left = anchorWorldX + geometry.offsetX;
    const top = SPRITE_CENTER_Y + geometry.offsetY - geometry.height / 2;
    const cx = left + geometry.width / 2;
    const cy = top + geometry.height / 2;
    view.body.setSize(geometry.width, geometry.height);
    view.body.setPosition(cx, cy);
    // Phaser's Rectangle hit-test area is set when setInteractive is called,
    // not updated automatically when setSize changes. Refresh the hit area
    // so the new size is clickable.
    view.body.input?.hitArea?.setSize?.(geometry.width, geometry.height);
    view.body.setFillStyle(HITBOX_FILL_COLOR, HITBOX_FILL_ALPHA);
    view.body.setStrokeStyle(1, HITBOX_STROKE_COLOR, 0.95);

    // Corner handles are always visible so drag-to-resize doesn't require
    // a separate click-to-select step. Position them at the four corners.
    const right = left + geometry.width;
    const bottom = top + geometry.height;
    const handlePositions: Record<HitboxHandleRole, { x: number; y: number }> = {
      tl: { x: left, y: top },
      tr: { x: right, y: top },
      bl: { x: left, y: bottom },
      br: { x: right, y: bottom },
    };
    for (const role of ['tl', 'tr', 'bl', 'br'] as const) {
      const handle = view.handles[role];
      const { x, y } = handlePositions[role];
      handle.setPosition(x, y);
      handle.setVisible(true);
    }
  }

  private createHitboxView(
    identifier: string,
    attackIndex: number,
    hitboxIndex: number,
  ): HitboxView {
    const body = this.add
      .rectangle(0, 0, 1, 1, HITBOX_FILL_COLOR, HITBOX_FILL_ALPHA)
      .setStrokeStyle(1, HITBOX_STROKE_COLOR, 0.95)
      .setOrigin(0.5, 0.5)
      .setDepth(4)
      .setInteractive({ draggable: true, cursor: 'move' });
    body.setData('role', 'hitbox-body');
    body.setData('identifier', identifier);
    body.setData('attackIndex', attackIndex);
    body.setData('hitboxIndex', hitboxIndex);
    this.input.setDraggable(body);

    const makeHandle = (role: HitboxHandleRole, cursor: string) => {
      const handle = this.add
        .rectangle(0, 0, HITBOX_HANDLE_SIZE, HITBOX_HANDLE_SIZE, HITBOX_HANDLE_COLOR, 0.95)
        .setStrokeStyle(1, 0x000000, 0.9)
        .setOrigin(0.5, 0.5)
        .setDepth(6)
        .setInteractive({ draggable: true, cursor });
      handle.setData('role', `hitbox-handle-${role}`);
      handle.setData('identifier', identifier);
      handle.setData('attackIndex', attackIndex);
      handle.setData('hitboxIndex', hitboxIndex);
      handle.setVisible(false);
      this.input.setDraggable(handle);
      return handle;
    };
    const handles: Record<HitboxHandleRole, Phaser.GameObjects.Rectangle> = {
      tl: makeHandle('tl', 'nwse-resize'),
      tr: makeHandle('tr', 'nesw-resize'),
      bl: makeHandle('bl', 'nesw-resize'),
      br: makeHandle('br', 'nwse-resize'),
    };
    return { attackIndex, hitboxIndex, body, handles };
  }

  private destroyHitboxView(key: string): void {
    const view = this.hitboxViews.get(key);
    if (!view) return;
    view.body.destroy();
    for (const role of ['tl', 'tr', 'bl', 'br'] as const) {
      view.handles[role].destroy();
    }
    this.hitboxViews.delete(key);
  }

  private destroyAllHitboxViews(): void {
    for (const key of [...this.hitboxViews.keys()]) {
      this.destroyHitboxView(key);
    }
  }

  // Hand-rolled dashed rect — Phaser Graphics has no built-in dashed stroke
  // and pulling a plugin in for two visual hints would be overkill.
  private drawDashedRect(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
  ): void {
    const dash = 3;
    const gap = 3;
    g.lineStyle(1, color, 0.9);
    const drawSegment = (x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (length === 0) return;
      const ux = dx / length;
      const uy = dy / length;
      let traveled = 0;
      let drawing = true;
      while (traveled < length) {
        const step = Math.min(drawing ? dash : gap, length - traveled);
        if (drawing) {
          g.lineBetween(
            x1 + ux * traveled,
            y1 + uy * traveled,
            x1 + ux * (traveled + step),
            y1 + uy * (traveled + step),
          );
        }
        traveled += step;
        drawing = !drawing;
      }
    };
    drawSegment(x, y, x + w, y);
    drawSegment(x + w, y, x + w, y + h);
    drawSegment(x + w, y + h, x, y + h);
    drawSegment(x, y + h, x, y);
  }

  private onDrag(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dragX: number,
    dragY: number,
  ): void {
    if (gameObject === this.anchorHandle) {
      this.handleAnchorDrag(dragX, dragY);
      return;
    }
    const role = (gameObject as Phaser.GameObjects.Rectangle).getData?.('role');
    if (typeof role === 'string' && role.startsWith('hitbox-')) {
      this.handleHitboxDrag(gameObject as Phaser.GameObjects.Rectangle, role, dragX, dragY);
      return;
    }
    if (typeof role === 'string' && role.startsWith('new-attack-')) {
      this.handleNewAttackDrag(gameObject as Phaser.GameObjects.Rectangle, role, dragX, dragY);
    }
  }

  private handleNewAttackDrag(
    obj: Phaser.GameObjects.Rectangle,
    role: string,
    dragX: number,
    dragY: number,
  ): void {
    const identifier = obj.getData('identifier') as string | undefined;
    const tempId = obj.getData('tempId') as string | undefined;
    if (!identifier || !tempId) return;
    const listing = this.currentListing;
    if (!listing) return;
    const editKey = `${identifier}::new::${tempId}`;
    const edit = this.currentState?.newAttackEdits.get(editKey);
    if (!edit) return;
    const { displayScale, anchorX } = resolveValues(
      listing,
      this.currentState?.edits.get(listing.fullKey),
    );
    const { frameWidth } = listing.anim.frames;
    const anchorWorldX =
      SPRITE_CENTER_X + (anchorX - frameWidth / 2) * displayScale;
    const currLeft = anchorWorldX + edit.offsetX;
    const currTop = SPRITE_CENTER_Y + edit.offsetY - edit.height / 2;
    const currRight = currLeft + edit.width;
    const currBottom = currTop + edit.height;
    let newLeft = currLeft;
    let newTop = currTop;
    let newRight = currRight;
    let newBottom = currBottom;
    if (role === 'new-attack-body') {
      newLeft = dragX - edit.width / 2;
      newTop = dragY - edit.height / 2;
      newRight = newLeft + edit.width;
      newBottom = newTop + edit.height;
    } else if (role === 'new-attack-handle-tl') {
      newLeft = Math.min(dragX, currRight - 1);
      newTop = Math.min(dragY, currBottom - 1);
    } else if (role === 'new-attack-handle-tr') {
      newRight = Math.max(dragX, currLeft + 1);
      newTop = Math.min(dragY, currBottom - 1);
    } else if (role === 'new-attack-handle-bl') {
      newLeft = Math.min(dragX, currRight - 1);
      newBottom = Math.max(dragY, currTop + 1);
    } else if (role === 'new-attack-handle-br') {
      newRight = Math.max(dragX, currLeft + 1);
      newBottom = Math.max(dragY, currTop + 1);
    }
    const newWidth = Math.max(1, Math.round(newRight - newLeft));
    const newHeight = Math.max(1, Math.round(newBottom - newTop));
    const newOffsetX = Math.round(newLeft - anchorWorldX);
    const newOffsetY = Math.round(newTop + newHeight / 2 - SPRITE_CENTER_Y);
    this.callbacks.onNewAttackHitboxDrag(identifier, tempId, {
      offsetX: newOffsetX,
      offsetY: newOffsetY,
      width: newWidth,
      height: newHeight,
    });
  }

  private handleAnchorDrag(dragX: number, dragY: number): void {
    const state = this.currentState;
    const listing = this.currentListing;
    if (!state || !listing || !state.selectedKey) return;
    const edit = state.edits.get(state.selectedKey);
    const resolved = resolveValues(listing, edit);
    if (resolved.displayScale <= 0) return;
    const { frameWidth, frameHeight } = listing.anim.frames;
    // Inverse of the anchor-world formula. dragX/Y are world coords because
    // Phaser drag events fire in world space (camera zoom doesn't affect them).
    const newAnchorX = Math.round(
      (dragX - SPRITE_CENTER_X) / resolved.displayScale + frameWidth / 2,
    );
    const newAnchorY = Math.round(
      (dragY - SPRITE_CENTER_Y) / resolved.displayScale + frameHeight / 2,
    );
    const clampedX = Math.max(0, Math.min(frameWidth, newAnchorX));
    const clampedY = Math.max(0, Math.min(frameHeight, newAnchorY));
    this.callbacks.onAnchorDrag(state.selectedKey, {
      anchorX: clampedX,
      anchorY: clampedY,
    });
  }

  // Computes the new geometry resulting from dragging a hitbox body (move)
  // or one of its corner handles (resize). Sends the patch through the
  // onHitboxDrag callback; integer-snaps offsets so the JSON stays clean.
  private handleHitboxDrag(
    obj: Phaser.GameObjects.Rectangle,
    role: string,
    dragX: number,
    dragY: number,
  ): void {
    const identifier = obj.getData('identifier') as string | undefined;
    const attackIndex = obj.getData('attackIndex') as number | undefined;
    const hitboxIndex = obj.getData('hitboxIndex') as number | undefined;
    if (!identifier || attackIndex === undefined || hitboxIndex === undefined) return;

    const view = this.hitboxViews.get(`${attackIndex}:${hitboxIndex}`);
    if (!view) return;
    const listing = this.currentListing;
    if (!listing) return;
    // Compute the current effective rect in world coords, used by corner-
    // resize math to anchor the opposite corner. Existing authored hitboxes
    // come from the binding map; pending creates come from state.attackEdits.
    const binding = this.findBinding(listing.fullKey, attackIndex);
    const authored = binding?.hitboxes.find((h) => h.hitboxIndex === hitboxIndex);
    let geo: { offsetX: number; offsetY: number; width: number; height: number };
    if (authored) {
      geo = this.resolveEffectiveHitbox(identifier, attackIndex, authored);
    } else {
      // Pending create — geometry is wholly in the edit.
      const pending = this.currentState?.attackEdits.get(
        `${identifier}:${attackIndex}:${hitboxIndex}`,
      );
      if (!pending) return;
      geo = {
        offsetX: pending.offsetX ?? 0,
        offsetY: pending.offsetY ?? 0,
        width: pending.width ?? 30,
        height: pending.height ?? 20,
      };
    }
    const { displayScale, anchorX } = resolveValues(listing, this.currentState?.edits.get(listing.fullKey));
    const { frameWidth } = listing.anim.frames;
    const anchorWorldX =
      SPRITE_CENTER_X + (anchorX - frameWidth / 2) * displayScale;
    const currLeft = anchorWorldX + geo.offsetX;
    const currTop = SPRITE_CENTER_Y + geo.offsetY - geo.height / 2;
    const currRight = currLeft + geo.width;
    const currBottom = currTop + geo.height;

    let newLeft = currLeft;
    let newTop = currTop;
    let newRight = currRight;
    let newBottom = currBottom;
    if (role === 'hitbox-body') {
      // Drag the body rect — translate the whole hitbox. dragX/Y is the
      // new center position (Rectangle origin = 0.5,0.5).
      newLeft = dragX - geo.width / 2;
      newTop = dragY - geo.height / 2;
      newRight = newLeft + geo.width;
      newBottom = newTop + geo.height;
    } else if (role === 'hitbox-handle-tl') {
      // Top-left handle: bottom-right is anchored. Clamp so width/height ≥ 1.
      newLeft = Math.min(dragX, currRight - 1);
      newTop = Math.min(dragY, currBottom - 1);
    } else if (role === 'hitbox-handle-tr') {
      newRight = Math.max(dragX, currLeft + 1);
      newTop = Math.min(dragY, currBottom - 1);
    } else if (role === 'hitbox-handle-bl') {
      newLeft = Math.min(dragX, currRight - 1);
      newBottom = Math.max(dragY, currTop + 1);
    } else if (role === 'hitbox-handle-br') {
      newRight = Math.max(dragX, currLeft + 1);
      newBottom = Math.max(dragY, currTop + 1);
    }
    const newWidth = Math.max(1, Math.round(newRight - newLeft));
    const newHeight = Math.max(1, Math.round(newBottom - newTop));
    const newOffsetX = Math.round(newLeft - anchorWorldX);
    const newOffsetY = Math.round(newTop + newHeight / 2 - SPRITE_CENTER_Y);
    this.callbacks.onHitboxDrag(identifier, attackIndex, hitboxIndex, {
      offsetX: newOffsetX,
      offsetY: newOffsetY,
      width: newWidth,
      height: newHeight,
    });
  }

  private findBinding(
    fullKey: string,
    attackIndex: number,
  ): import('./attackBindings').AttackBinding | null {
    const bindings = this.attackBindings.get(fullKey);
    if (!bindings) return null;
    for (const binding of bindings) {
      if (binding.attackIndex === attackIndex) return binding;
    }
    return null;
  }


  // Light dotted grid centered on the sprite origin so the user can eyeball
  // pixel coordinates relative to (0,0) regardless of zoom.
  private drawCheckerboard(): void {
    const g = this.gridGraphics;
    if (!g) return;
    g.clear();
    g.fillStyle(0x252525, 1);
    g.fillRect(-200, -200, 400, 400);
    g.lineStyle(1, 0x333333, 1);
    for (let x = -200; x <= 200; x += 8) {
      g.lineBetween(x, -200, x, 200);
    }
    for (let y = -200; y <= 200; y += 8) {
      g.lineBetween(-200, y, 200, y);
    }
    // Origin crosshair.
    g.lineStyle(1, 0x555555, 1);
    g.lineBetween(-200, 0, 200, 0);
    g.lineBetween(0, -200, 0, 200);
  }
}
