import type { AnimationListing } from '../../src/sprites/characterLoader';

export interface AnimationEdit {
  readonly displayScale?: number;
  readonly anchorX?: number;
  readonly anchorY?: number;
}

// physicsBody is per-entity (one block per LDtk identifier, shared across
// all that identifier's animations), so body edits are keyed separately
// from the per-animation `edits` map. Player listings never produce body
// edits — only entity listings have a physicsBody to edit.
export interface BodyEdit {
  readonly width?: number;
  readonly height?: number;
}

// Per-attack hitbox edit. offsetX/offsetY are world-pixel offsets from the
// entity's body center (matching the runtime formula in Enemy.ts: hx = x +
// offsetX, hy = y + offsetY - height/2 when facing right). width/height are
// world-pixel sizes. The tool shows the un-mirrored (right-facing) authored
// values; runtime mirrors offsetX when the entity faces left.
//
// `create` flags a brand-new hitbox to append to the attack's array. The
// other fields supply the new hitbox's initial geometry; `frame` is required
// for creates (otherwise the new rect wouldn't know when to fire).
// `delete` flags removal of an existing hitbox. The two flags are mutually
// exclusive — see save-plugin.mjs for the server-side enforcement.
export interface HitboxEdit {
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly width?: number;
  readonly height?: number;
  readonly frame?: number;
  readonly create?: boolean;
  readonly delete?: boolean;
}

// Composite key for attackEdits: `${identifier}:${attackIndex}:${hitboxIndex}`.
// attackIndex = -1 ⇒ behavior.attack (single-attack entities)
// attackIndex >= 0 ⇒ behavior.attackPool[attackIndex]
// hitboxIndex ⇒ index inside the attack's normalized hitboxes array (always
//   non-negative; even the single `hitbox` form normalizes to [0]).
export function attackEditKey(
  identifier: string,
  attackIndex: number,
  hitboxIndex: number,
): string {
  return `${identifier}:${attackIndex}:${hitboxIndex}`;
}

// Brand-new attack created for an entity animation that wasn't previously
// bound to any attack. Carries the minimum needed to render an editable
// hitbox in the preview and produce a valid AnimatedEntityAttackConfig on
// save. Non-mandatory fields (damage, range, cooldownMs, aggressive) come
// from server-side defaults — the user can refine them by editing the JSON
// once the attack lands in the file.
//
// Keying: ResizerState.newAttackEdits is `${identifier}::new::${tempId}`.
// The `::new::` separator differentiates from the `${identifier}:${attackIndex}:${hitboxIndex}`
// scheme used by attackEdits so parsers can't confuse the two.
export interface NewAttackEdit {
  readonly animation: string;
  readonly frame: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export function newAttackEditKey(identifier: string, tempId: string): string {
  return `${identifier}::new::${tempId}`;
}

export function parseNewAttackEditKey(
  key: string,
): { identifier: string; tempId: string } | null {
  const marker = '::new::';
  const idx = key.indexOf(marker);
  if (idx <= 0) return null;
  return {
    identifier: key.slice(0, idx),
    tempId: key.slice(idx + marker.length),
  };
}

export interface ResizerState {
  readonly edits: ReadonlyMap<string, AnimationEdit>;
  readonly bodyEdits: ReadonlyMap<string, BodyEdit>;
  readonly attackEdits: ReadonlyMap<string, HitboxEdit>;
  readonly newAttackEdits: ReadonlyMap<string, NewAttackEdit>;
  readonly selectedKey: string | null;
}

export interface ResolvedAnimationValues {
  readonly displayScale: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly anchorXIsExplicit: boolean;
  readonly anchorYIsExplicit: boolean;
}

export const INITIAL_STATE: ResizerState = {
  edits: new Map(),
  bodyEdits: new Map(),
  attackEdits: new Map(),
  newAttackEdits: new Map(),
  selectedKey: null,
};

export function setSelected(
  state: ResizerState,
  selectedKey: string | null,
): ResizerState {
  if (state.selectedKey === selectedKey) return state;
  return { ...state, selectedKey };
}

export function patchEdit(
  state: ResizerState,
  fullKey: string,
  patch: AnimationEdit,
): ResizerState {
  const next = new Map(state.edits);
  const existing = next.get(fullKey) ?? {};
  const merged: AnimationEdit = { ...existing, ...patch };
  if (
    merged.displayScale === undefined &&
    merged.anchorX === undefined &&
    merged.anchorY === undefined
  ) {
    next.delete(fullKey);
  } else {
    next.set(fullKey, merged);
  }
  return { ...state, edits: next };
}

export function clearEdit(
  state: ResizerState,
  fullKey: string,
): ResizerState {
  if (!state.edits.has(fullKey)) return state;
  const next = new Map(state.edits);
  next.delete(fullKey);
  return { ...state, edits: next };
}

export function patchBodyEdit(
  state: ResizerState,
  identifier: string,
  patch: BodyEdit,
): ResizerState {
  const next = new Map(state.bodyEdits);
  const existing = next.get(identifier) ?? {};
  const merged: BodyEdit = { ...existing, ...patch };
  if (merged.width === undefined && merged.height === undefined) {
    next.delete(identifier);
  } else {
    next.set(identifier, merged);
  }
  return { ...state, bodyEdits: next };
}

export function clearBodyEdit(
  state: ResizerState,
  identifier: string,
): ResizerState {
  if (!state.bodyEdits.has(identifier)) return state;
  const next = new Map(state.bodyEdits);
  next.delete(identifier);
  return { ...state, bodyEdits: next };
}

export function patchAttackEdit(
  state: ResizerState,
  identifier: string,
  attackIndex: number,
  hitboxIndex: number,
  patch: HitboxEdit,
): ResizerState {
  const key = attackEditKey(identifier, attackIndex, hitboxIndex);
  const next = new Map(state.attackEdits);
  const existing = next.get(key) ?? {};
  const merged: HitboxEdit = { ...existing, ...patch };
  // An edit with no fields set has no effect; drop it so the diff list and
  // save payload stay clean. `create` and `delete` count as fields.
  if (
    merged.offsetX === undefined &&
    merged.offsetY === undefined &&
    merged.width === undefined &&
    merged.height === undefined &&
    merged.frame === undefined &&
    !merged.create &&
    !merged.delete
  ) {
    next.delete(key);
  } else {
    next.set(key, merged);
  }
  return { ...state, attackEdits: next };
}

export function clearAttackEdit(
  state: ResizerState,
  identifier: string,
  attackIndex: number,
  hitboxIndex: number,
): ResizerState {
  const key = attackEditKey(identifier, attackIndex, hitboxIndex);
  if (!state.attackEdits.has(key)) return state;
  const next = new Map(state.attackEdits);
  next.delete(key);
  return { ...state, attackEdits: next };
}

// Adds a brand-new attack on the given animation with default hitbox
// geometry. tempId is generated from the current state size so re-renders
// keep stable keys for in-progress edits. Returns the new state plus the
// chosen tempId so the caller can refer to it (e.g., to focus the row).
export function addNewAttack(
  state: ResizerState,
  identifier: string,
  animation: string,
  frame: number,
): { state: ResizerState; tempId: string } {
  // tempId must be unique even after the user adds and removes multiple
  // attacks; counting current entries handles "add three, remove one, add
  // one more" without colliding by tracking the high-water mark via Date.
  const tempId = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const next = new Map(state.newAttackEdits);
  next.set(newAttackEditKey(identifier, tempId), {
    animation,
    frame,
    offsetX: 0,
    offsetY: 0,
    width: 30,
    height: 20,
  });
  return { state: { ...state, newAttackEdits: next }, tempId };
}

export function patchNewAttack(
  state: ResizerState,
  identifier: string,
  tempId: string,
  patch: Partial<NewAttackEdit>,
): ResizerState {
  const key = newAttackEditKey(identifier, tempId);
  const existing = state.newAttackEdits.get(key);
  if (!existing) return state;
  const next = new Map(state.newAttackEdits);
  next.set(key, { ...existing, ...patch });
  return { ...state, newAttackEdits: next };
}

export function removeNewAttack(
  state: ResizerState,
  identifier: string,
  tempId: string,
): ResizerState {
  const key = newAttackEditKey(identifier, tempId);
  if (!state.newAttackEdits.has(key)) return state;
  const next = new Map(state.newAttackEdits);
  next.delete(key);
  return { ...state, newAttackEdits: next };
}

// Merges any pending edit for this binding/hitbox into the authored values.
// Used by both PreviewScene (to draw the live geometry) and EditPanel (to
// seed the input fields). Returns the effective {offsetX, offsetY, width,
// height}; matchBody hitboxes always return zeros — they're not edited.
export function resolveHitboxGeometry(
  identifier: string,
  attackIndex: number,
  hitboxIndex: number,
  base: { offsetX: number; offsetY: number; width: number; height: number },
  edits: ReadonlyMap<string, HitboxEdit>,
): { offsetX: number; offsetY: number; width: number; height: number } {
  const edit = edits.get(attackEditKey(identifier, attackIndex, hitboxIndex));
  if (!edit) return base;
  return {
    offsetX: edit.offsetX ?? base.offsetX,
    offsetY: edit.offsetY ?? base.offsetY,
    width: edit.width ?? base.width,
    height: edit.height ?? base.height,
  };
}

export function resolveValues(
  listing: AnimationListing,
  edit: AnimationEdit | undefined,
): ResolvedAnimationValues {
  const { frameWidth, frameHeight, anchorX, anchorY, displayScale } =
    listing.anim.frames;
  const effectiveAnchorX =
    edit?.anchorX ?? anchorX ?? frameWidth / 2;
  const effectiveAnchorY =
    edit?.anchorY ?? anchorY ?? frameHeight;
  const effectiveScale = edit?.displayScale ?? displayScale ?? 1;
  return {
    displayScale: effectiveScale,
    anchorX: effectiveAnchorX,
    anchorY: effectiveAnchorY,
    anchorXIsExplicit: edit?.anchorX !== undefined || anchorX !== undefined,
    anchorYIsExplicit: edit?.anchorY !== undefined || anchorY !== undefined,
  };
}

// Bulk-apply helpers used by the EditPanel buttons. Each returns a new state;
// callers are responsible for triggering a render after.

export function copyScaleToRegistry(
  state: ResizerState,
  registryId: string,
  listings: ReadonlyArray<AnimationListing>,
  scale: number,
): ResizerState {
  let next = state;
  for (const listing of listings) {
    if (listing.registry.id !== registryId) continue;
    next = patchEdit(next, listing.fullKey, { displayScale: scale });
  }
  return next;
}

export function applyAnchorsToUnset(
  state: ResizerState,
  registryId: string,
  listings: ReadonlyArray<AnimationListing>,
  anchorX: number | null,
  anchorY: number | null,
): ResizerState {
  let next = state;
  for (const listing of listings) {
    if (listing.registry.id !== registryId) continue;
    const existing = next.edits.get(listing.fullKey);
    let patchX: number | undefined;
    let patchY: number | undefined;
    if (
      anchorX !== null &&
      listing.anim.frames.anchorX === undefined &&
      existing?.anchorX === undefined
    ) {
      patchX = anchorX;
    }
    if (
      anchorY !== null &&
      listing.anim.frames.anchorY === undefined &&
      existing?.anchorY === undefined
    ) {
      patchY = anchorY;
    }
    if (patchX !== undefined || patchY !== undefined) {
      const patch: AnimationEdit = { anchorX: patchX, anchorY: patchY };
      next = patchEdit(next, listing.fullKey, patch);
    }
  }
  return next;
}
