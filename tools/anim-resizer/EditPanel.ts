import type { AnimationListing } from '../../src/sprites/characterLoader';
import {
  parseNewAttackEditKey,
  resolveHitboxGeometry,
  resolveValues,
  type AnimationEdit,
  type BodyEdit,
  type HitboxEdit,
  type NewAttackEdit,
  type ResizerState,
} from './state';
import type { AttackBindingsMap, NormalizedHitbox } from './attackBindings';

export interface EditPanelCallbacks {
  readonly onPatch: (fullKey: string, patch: AnimationEdit) => void;
  readonly onPatchBody: (identifier: string, patch: BodyEdit) => void;
  readonly onResetAnimation: (fullKey: string) => void;
  readonly onCopyScaleToRegistry: (registryId: string, scale: number) => void;
  readonly onApplyAnchorsToUnset: (
    registryId: string,
    anchorX: number | null,
    anchorY: number | null,
  ) => void;
  readonly onResetAll: () => void;
  readonly onSave: () => void;
  readonly onPatchHitbox: (
    identifier: string,
    attackIndex: number,
    hitboxIndex: number,
    patch: HitboxEdit,
  ) => void;
  readonly onResetHitbox: (
    identifier: string,
    attackIndex: number,
    hitboxIndex: number,
  ) => void;
  readonly onAddHitbox: (
    identifier: string,
    attackIndex: number,
    frame: number,
  ) => void;
  readonly onRemoveHitbox: (
    identifier: string,
    attackIndex: number,
    hitboxIndex: number,
  ) => void;
  // Bootstraps a brand-new melee attack on an animation that wasn't
  // previously used by any attack. Server-side gets a full attack config
  // appended to behavior.attackPool with default fields.
  readonly onCreateNewAttack: (
    identifier: string,
    animation: string,
    frame: number,
  ) => void;
  readonly onPatchNewAttackHitbox: (
    identifier: string,
    tempId: string,
    patch: Partial<NewAttackEdit>,
  ) => void;
  readonly onRemoveNewAttack: (identifier: string, tempId: string) => void;
  // Returns the current sprite-frame index (0-based) so "add hitbox on this
  // frame" can stamp the right frame. Implemented as a callback so the panel
  // doesn't need a direct PreviewScene reference.
  readonly getCurrentFrame: () => number;
}

// Per-identifier body lookup. The EditPanel needs to know the original
// width/height for the currently selected entity to show alongside the
// pending edit. Populated by setListings.
interface BodyDefaults {
  readonly width: number;
  readonly height: number;
}

const PANEL_WIDTH = 320;

export class EditPanel {
  private readonly root: HTMLDivElement;
  private readonly emptyHint: HTMLDivElement;
  private readonly form: HTMLDivElement;
  private readonly selectedLabel: HTMLDivElement;
  private readonly scaleRange: HTMLInputElement;
  private readonly scaleNumber: HTMLInputElement;
  private readonly anchorXRange: HTMLInputElement;
  private readonly anchorXNumber: HTMLInputElement;
  private readonly anchorYRange: HTMLInputElement;
  private readonly anchorYNumber: HTMLInputElement;
  private readonly bodySection: HTMLDivElement;
  private readonly bodyWidthNumber: HTMLInputElement;
  private readonly bodyHeightNumber: HTMLInputElement;
  private readonly hitboxSection: HTMLDivElement;
  private readonly hitboxSummary: HTMLDivElement;
  private readonly resetAnimBtn: HTMLButtonElement;
  private readonly copyScaleBtn: HTMLButtonElement;
  private readonly applyAnchorsBtn: HTMLButtonElement;
  private readonly resetAllBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly diffList: HTMLDivElement;
  private readonly statusLine: HTMLDivElement;

  private callbacks: EditPanelCallbacks;
  private listingByKey: Map<string, AnimationListing> = new Map();
  // Per-identifier original body sizes, populated from listings. Used both
  // to seed the inputs and to render the diff list ("48 → 24" style).
  private bodyDefaults: Map<string, BodyDefaults> = new Map();
  private attackBindings: AttackBindingsMap = new Map();
  private currentState: ResizerState | null = null;

  constructor(parent: HTMLElement, callbacks: EditPanelCallbacks) {
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'anim-resizer-panel';
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
    this.emptyHint.textContent = 'Click an animation to edit.';
    this.emptyHint.style.color = '#888';
    this.root.appendChild(this.emptyHint);

    this.form = document.createElement('div');
    this.form.style.display = 'none';
    this.root.appendChild(this.form);

    this.selectedLabel = document.createElement('div');
    this.selectedLabel.style.cssText = [
      'font-family: monospace',
      'font-size: 13px',
      'color: #9cdcfe',
      'margin-bottom: 12px',
      'word-break: break-all',
    ].join(';');
    this.form.appendChild(this.selectedLabel);

    const scaleRow = this.makeRow('displayScale', 0.1, 4, 0.05);
    this.scaleRange = scaleRow.range;
    this.scaleNumber = scaleRow.number;
    this.form.appendChild(scaleRow.row);

    const anchorXRow = this.makeRow('anchorX', 0, 0, 1);
    this.anchorXRange = anchorXRow.range;
    this.anchorXNumber = anchorXRow.number;
    this.form.appendChild(anchorXRow.row);

    const anchorYRow = this.makeRow('anchorY', 0, 0, 1);
    this.anchorYRange = anchorYRow.range;
    this.anchorYNumber = anchorYRow.number;
    this.form.appendChild(anchorYRow.row);

    // physicsBody width/height section — only shown for entity listings.
    // Per-identifier (not per-animation), so editing here affects every
    // animation of that entity.
    this.bodySection = document.createElement('div');
    this.bodySection.style.cssText =
      'margin: 16px 0; padding: 10px; background: #181818; border: 1px solid #2a2a2a;';
    const bodyHeader = document.createElement('div');
    bodyHeader.textContent = 'physicsBody (entity)';
    bodyHeader.style.cssText =
      'font-size: 11px; color: #9cdcfe; margin-bottom: 6px; font-weight: 600;';
    this.bodySection.appendChild(bodyHeader);
    const widthRow = this.makeNumberOnlyRow('width', 1);
    this.bodyWidthNumber = widthRow.number;
    this.bodySection.appendChild(widthRow.row);
    const heightRow = this.makeNumberOnlyRow('height', 1);
    this.bodyHeightNumber = heightRow.number;
    this.bodySection.appendChild(heightRow.row);
    this.form.appendChild(this.bodySection);

    // Hitbox section — shown only when the selected animation is used as
    // a strike clip by at least one melee/teleport attack. Phase 1 renders
    // a read-only summary; Phase 2 fills in per-hitbox edit rows.
    this.hitboxSection = document.createElement('div');
    this.hitboxSection.style.cssText =
      'margin: 16px 0; padding: 10px; background: #181818; border: 1px solid #2a2a2a; display: none;';
    const hitboxHeader = document.createElement('div');
    hitboxHeader.textContent = 'Attack hitboxes';
    hitboxHeader.style.cssText =
      'font-size: 11px; color: #ffd166; margin-bottom: 6px; font-weight: 600;';
    this.hitboxSection.appendChild(hitboxHeader);
    this.hitboxSummary = document.createElement('div');
    this.hitboxSummary.style.cssText =
      'font-family: monospace; font-size: 11px; color: #c0c0c0; line-height: 1.5; white-space: pre-wrap;';
    this.hitboxSection.appendChild(this.hitboxSummary);
    this.form.appendChild(this.hitboxSection);

    this.resetAnimBtn = this.makeButton('Reset this animation');
    this.copyScaleBtn = this.makeButton('Copy scale to registry');
    this.applyAnchorsBtn = this.makeButton('Apply anchors to unset in registry');
    this.form.appendChild(this.resetAnimBtn);
    this.form.appendChild(this.copyScaleBtn);
    this.form.appendChild(this.applyAnchorsBtn);

    const divider = document.createElement('hr');
    divider.style.cssText =
      'border: none; border-top: 1px solid #2a2a2a; margin: 16px 0;';
    this.root.appendChild(divider);

    const diffHeader = document.createElement('div');
    diffHeader.textContent = 'Pending edits';
    diffHeader.style.cssText =
      'font-weight: 600; color: #cccccc; margin-bottom: 6px;';
    this.root.appendChild(diffHeader);

    this.diffList = document.createElement('div');
    this.diffList.style.cssText =
      'font-family: monospace; font-size: 11px; color: #c0c0c0; line-height: 1.4;';
    this.root.appendChild(this.diffList);

    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display: flex; gap: 8px; margin-top: 12px;';
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

  // Populated separately because physicsBody lives on the entity registry
  // entry, not on each AnimationListing. Caller (main.ts) collects this
  // once via listEntityRegistryEntries().
  setBodyDefaults(defaults: ReadonlyMap<string, BodyDefaults>): void {
    this.bodyDefaults = new Map(defaults);
  }

  // Attack bindings drive the hitbox section's visibility and contents.
  // Phase 1 uses this for read-only display only; Phase 2 wires editing.
  setAttackBindings(bindings: AttackBindingsMap): void {
    this.attackBindings = bindings;
    if (this.currentState) this.render(this.currentState);
  }

  setStatus(text: string, isError = false): void {
    this.statusLine.textContent = text;
    this.statusLine.style.color = isError ? '#f48771' : '#888';
  }

  render(state: ResizerState): void {
    this.currentState = state;
    const selected = state.selectedKey
      ? this.listingByKey.get(state.selectedKey) ?? null
      : null;

    if (!selected) {
      this.emptyHint.style.display = 'block';
      this.form.style.display = 'none';
    } else {
      this.emptyHint.style.display = 'none';
      this.form.style.display = 'block';
      this.selectedLabel.textContent = selected.fullKey;
      const edit = state.edits.get(selected.fullKey);
      const resolved = resolveValues(selected, edit);

      this.scaleRange.value = resolved.displayScale.toFixed(2);
      this.scaleNumber.value = resolved.displayScale.toFixed(2);

      this.anchorXRange.max = String(selected.anim.frames.frameWidth);
      this.anchorXNumber.max = String(selected.anim.frames.frameWidth);
      this.anchorXRange.value = String(resolved.anchorX);
      this.anchorXNumber.value = String(resolved.anchorX);

      this.anchorYRange.max = String(selected.anim.frames.frameHeight);
      this.anchorYNumber.max = String(selected.anim.frames.frameHeight);
      this.anchorYRange.value = String(resolved.anchorY);
      this.anchorYNumber.value = String(resolved.anchorY);

      // physicsBody inputs visible only when an entity is selected.
      const identifier = selected.entityIdentifier;
      const defaults = identifier ? this.bodyDefaults.get(identifier) : undefined;
      if (identifier && defaults) {
        const bodyEdit = state.bodyEdits.get(identifier);
        this.bodySection.style.display = 'block';
        this.bodyWidthNumber.value = String(bodyEdit?.width ?? defaults.width);
        this.bodyHeightNumber.value = String(bodyEdit?.height ?? defaults.height);
      } else {
        this.bodySection.style.display = 'none';
      }

      this.renderHitboxSection(selected.fullKey);
    }

    this.renderDiffList(state);
  }

  private renderHitboxSection(fullKey: string): void {
    const selected = this.listingByKey.get(fullKey);
    const isEntity = !!selected?.entityIdentifier;
    const identifier = selected?.entityIdentifier ?? null;
    const animation = selected?.anim.key ?? null;
    const bindings = this.attackBindings.get(fullKey);
    const hasBindings = !!bindings && bindings.length > 0;
    const state = this.currentState;
    // Pending new-attack edits scoped to this identifier + animation. These
    // belong inline with the bindings list (visually they're "new attacks
    // about to be added to this animation").
    const pendingNewAttacks: { tempId: string; edit: NewAttackEdit }[] = [];
    if (state && identifier && animation) {
      for (const [key, edit] of state.newAttackEdits) {
        const parsed = parseNewAttackEditKey(key);
        if (!parsed) continue;
        if (parsed.identifier !== identifier) continue;
        if (edit.animation !== animation) continue;
        pendingNewAttacks.push({ tempId: parsed.tempId, edit });
      }
    }
    // For entity animations, always show the section so the user can
    // bootstrap a new attack. For player animations (no entityIdentifier),
    // hitbox editing isn't supported, so hide unless bindings exist (which
    // shouldn't happen for player animations either).
    if (!isEntity && !hasBindings) {
      this.hitboxSection.style.display = 'none';
      return;
    }
    this.hitboxSection.style.display = 'block';
    // Rebuild the rows on each render. The set is small (typically ≤6 per
    // animation) so the DOM churn is fine and the row state stays in sync
    // with state/edit changes without manual diffing.
    this.hitboxSummary.replaceChildren();
    if (!hasBindings) {
      const emptyNote = document.createElement('div');
      emptyNote.textContent =
        'No attack uses this animation yet. Add a new melee attack to start authoring hitboxes here.';
      emptyNote.style.cssText = 'color: #888; font-size: 11px; margin: 4px 0;';
      this.hitboxSummary.appendChild(emptyNote);
    }
    for (const binding of bindings ?? []) {
      const attackLabel =
        binding.attackIndex === -1
          ? `attack (${binding.attack.type})`
          : `attackPool[${binding.attackIndex}] (${binding.attack.type})`;
      const header = document.createElement('div');
      header.style.cssText =
        'color: #ffd166; font-weight: 600; margin-top: 6px; display: flex; align-items: center; gap: 6px;';
      const headerText = document.createElement('span');
      headerText.textContent = attackLabel;
      headerText.style.flex = '1';
      header.appendChild(headerText);
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ add on current frame';
      addBtn.title =
        'Append a new hitbox to this attack, stamped on the sprite preview\'s current frame.';
      addBtn.style.cssText =
        'font-size: 10px; padding: 1px 6px; background: #264f78; color: #fff; border: 1px solid #2a2a2a; cursor: pointer;';
      addBtn.addEventListener('click', () => {
        this.callbacks.onAddHitbox(
          binding.identifier,
          binding.attackIndex,
          this.callbacks.getCurrentFrame(),
        );
      });
      header.appendChild(addBtn);
      this.hitboxSummary.appendChild(header);
      // Authored hitboxes (from registry).
      for (const hb of binding.hitboxes) {
        this.hitboxSummary.appendChild(
          this.makeHitboxRow(binding.identifier, binding.attackIndex, hb, state, false),
        );
      }
      // Pending creates (client-side, not yet saved). Render them as rows so
      // the user can edit/remove before save. Iteration is over state.attackEdits
      // filtered to this attack, sorted by hitboxIndex for stable order.
      if (state) {
        const creates: NormalizedHitbox[] = [];
        for (const [key, edit] of state.attackEdits) {
          const parts = key.split(':');
          if (
            parts[0] !== binding.identifier ||
            Number(parts[1]) !== binding.attackIndex ||
            !edit.create
          ) {
            continue;
          }
          const hitboxIndex = Number(parts[2]);
          creates.push({
            hitboxIndex,
            offsetX: edit.offsetX ?? 0,
            offsetY: edit.offsetY ?? 0,
            width: edit.width ?? 30,
            height: edit.height ?? 20,
            frame: edit.frame ?? 0,
            matchBody: false,
          });
        }
        creates.sort((a, b) => a.hitboxIndex - b.hitboxIndex);
        for (const hb of creates) {
          this.hitboxSummary.appendChild(
            this.makeHitboxRow(binding.identifier, binding.attackIndex, hb, state, true),
          );
        }
      }
    }

    // Pending new attacks bound to this animation. Each renders as a row
    // group with one hitbox row (the starter rect).
    for (const { tempId, edit } of pendingNewAttacks) {
      this.hitboxSummary.appendChild(
        this.makeNewAttackRow(identifier!, tempId, edit),
      );
    }

    // "Create new melee attack" affordance — only useful when the user
    // has an entity selected and the animation has no current binding.
    // Showing it regardless of bindings would clutter the UI for animations
    // that already have attacks attached.
    if (isEntity && identifier && animation && !hasBindings) {
      const createBtn = document.createElement('button');
      createBtn.textContent = '+ create melee attack on this animation';
      createBtn.title =
        'Bootstraps a new melee attack on this entity with default fields ' +
        '(damage 10, range 60, cooldownMs 2000) and a starter hitbox stamped ' +
        'on the current frame. Edit defaults via JSON after saving.';
      createBtn.style.cssText =
        'margin-top: 8px; width: 100%; padding: 6px 8px; background: #264f78; color: #fff; border: 1px solid #2a2a2a; cursor: pointer; font-size: 11px;';
      createBtn.addEventListener('click', () => {
        this.callbacks.onCreateNewAttack(
          identifier,
          animation,
          this.callbacks.getCurrentFrame(),
        );
      });
      this.hitboxSummary.appendChild(createBtn);
    }
  }

  private makeNewAttackRow(
    identifier: string,
    tempId: string,
    edit: NewAttackEdit,
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-top: 8px;';
    const header = document.createElement('div');
    header.style.cssText =
      'color: #99ff99; font-weight: 600; display: flex; align-items: center; gap: 6px;';
    const headerText = document.createElement('span');
    headerText.textContent = `NEW melee attack · frame ${edit.frame}`;
    headerText.style.flex = '1';
    header.appendChild(headerText);
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'cancel';
    cancelBtn.style.cssText =
      'font-size: 10px; padding: 1px 6px; background: #4f2626; color: #fff; border: 1px solid #2a2a2a; cursor: pointer;';
    cancelBtn.addEventListener('click', () => {
      this.callbacks.onRemoveNewAttack(identifier, tempId);
    });
    header.appendChild(cancelBtn);
    wrapper.appendChild(header);

    const note = document.createElement('div');
    note.style.cssText = 'font-size: 10px; color: #888; margin: 2px 0 4px;';
    note.textContent =
      'Saves with defaults: damage 10, range 60, cooldownMs 2000, aggressive=true. Edit JSON after to refine.';
    wrapper.appendChild(note);

    const row = document.createElement('div');
    row.style.cssText =
      'margin: 4px 0 6px 8px; padding: 6px; background: #0d1a0d; border: 1px solid #2a2a2a;';
    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px;';
    const addField = (
      label: string,
      value: number,
      min: number,
      onChange: (v: number) => void,
    ) => {
      const wrap = document.createElement('label');
      wrap.style.cssText =
        'display: flex; align-items: center; gap: 4px; font-size: 11px; color: #888;';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      labelEl.style.minWidth = '22px';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.min = String(min);
      input.value = String(value);
      input.style.cssText =
        'width: 60px; background: #1e1e1e; color: #ddd; border: 1px solid #333; padding: 1px 4px;';
      input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) onChange(Math.round(v));
      });
      wrap.appendChild(labelEl);
      wrap.appendChild(input);
      grid.appendChild(wrap);
    };
    addField('x', edit.offsetX, -9999, (v) =>
      this.callbacks.onPatchNewAttackHitbox(identifier, tempId, { offsetX: v }),
    );
    addField('y', edit.offsetY, -9999, (v) =>
      this.callbacks.onPatchNewAttackHitbox(identifier, tempId, { offsetY: v }),
    );
    addField('w', edit.width, 1, (v) =>
      this.callbacks.onPatchNewAttackHitbox(identifier, tempId, { width: Math.max(1, v) }),
    );
    addField('h', edit.height, 1, (v) =>
      this.callbacks.onPatchNewAttackHitbox(identifier, tempId, { height: Math.max(1, v) }),
    );
    row.appendChild(grid);
    wrapper.appendChild(row);
    return wrapper;
  }

  // Any hitbox is removable. The server processes patches *before* deletes
  // (against original indices), so deleting hitbox N never invalidates
  // pending patches on other hitboxes on the same attack — see
  // save-plugin.mjs::applyHitboxEntriesToAttack. The only guard is "don't
  // wipe the last surviving hitbox" since the registry parser requires
  // melee/teleport attacks to carry at least one rect; that's enforced
  // server-side on save.
  private canRemoveHitbox(): boolean {
    return true;
  }

  private makeHitboxRow(
    identifier: string,
    attackIndex: number,
    hb: NormalizedHitbox,
    state: ResizerState | null,
    isCreate: boolean,
  ): HTMLElement {
    const row = document.createElement('div');
    // Pending-delete edits gray out the row so the user sees what's queued
    // for removal on save. Pending creates get a green tint.
    const pendingEdit = state?.attackEdits.get(
      `${identifier}:${attackIndex}:${hb.hitboxIndex}`,
    );
    const pendingDelete = pendingEdit?.delete === true;
    const bg = pendingDelete
      ? '#1a0d0d'
      : isCreate
      ? '#0d1a0d'
      : '#0d0d0d';
    row.style.cssText = `margin: 4px 0 6px 8px; padding: 6px; background: ${bg}; border: 1px solid #2a2a2a;`;
    const title = document.createElement('div');
    title.style.cssText =
      'font-size: 11px; color: #aaa; margin-bottom: 4px; display: flex; gap: 6px; align-items: center;';
    if (hb.matchBody) {
      title.textContent = `hb#${hb.hitboxIndex} · frame ${hb.frame} · matchBody (read-only)`;
      row.appendChild(title);
      return row;
    }
    const titleText = document.createElement('span');
    const tag = isCreate ? ' · NEW' : pendingDelete ? ' · pending delete' : '';
    titleText.textContent = `hb#${hb.hitboxIndex} · frame ${hb.frame}${tag}`;
    titleText.style.flex = '1';
    title.appendChild(titleText);
    const resetBtn = document.createElement('button');
    resetBtn.textContent = isCreate || pendingDelete ? 'undo' : 'reset';
    resetBtn.style.cssText =
      'font-size: 10px; padding: 1px 6px; background: #1e1e1e; color: #aaa; border: 1px solid #333; cursor: pointer;';
    resetBtn.addEventListener('click', () => {
      this.callbacks.onResetHitbox(identifier, attackIndex, hb.hitboxIndex);
    });
    title.appendChild(resetBtn);
    if (!pendingDelete && this.canRemoveHitbox()) {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'remove';
      removeBtn.title = isCreate
        ? 'Drop this pending hitbox before saving.'
        : 'Mark this hitbox for deletion on save.';
      removeBtn.style.cssText =
        'font-size: 10px; padding: 1px 6px; background: #4f2626; color: #fff; border: 1px solid #2a2a2a; cursor: pointer;';
      removeBtn.addEventListener('click', () => {
        this.callbacks.onRemoveHitbox(identifier, attackIndex, hb.hitboxIndex);
      });
      title.appendChild(removeBtn);
    }
    row.appendChild(title);

    // Resolve effective values (authored + any pending edit) so the inputs
    // mirror what the overlay shows after a drag.
    const base = {
      offsetX: hb.offsetX,
      offsetY: hb.offsetY,
      width: hb.width,
      height: hb.height,
    };
    const effective = state
      ? resolveHitboxGeometry(identifier, attackIndex, hb.hitboxIndex, base, state.attackEdits)
      : base;

    const grid = document.createElement('div');
    grid.style.cssText =
      'display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px;';
    const addField = (label: string, value: number, min: number, onChange: (v: number) => void) => {
      const wrap = document.createElement('label');
      wrap.style.cssText =
        'display: flex; align-items: center; gap: 4px; font-size: 11px; color: #888;';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      labelEl.style.minWidth = '22px';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.min = String(min);
      input.value = String(value);
      input.style.cssText =
        'width: 60px; background: #1e1e1e; color: #ddd; border: 1px solid #333; padding: 1px 4px;';
      input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) onChange(Math.round(v));
      });
      wrap.appendChild(labelEl);
      wrap.appendChild(input);
      grid.appendChild(wrap);
    };
    addField('x', effective.offsetX, -9999, (v) => {
      this.callbacks.onPatchHitbox(identifier, attackIndex, hb.hitboxIndex, { offsetX: v });
    });
    addField('y', effective.offsetY, -9999, (v) => {
      this.callbacks.onPatchHitbox(identifier, attackIndex, hb.hitboxIndex, { offsetY: v });
    });
    addField('w', effective.width, 1, (v) => {
      this.callbacks.onPatchHitbox(identifier, attackIndex, hb.hitboxIndex, { width: Math.max(1, v) });
    });
    addField('h', effective.height, 1, (v) => {
      this.callbacks.onPatchHitbox(identifier, attackIndex, hb.hitboxIndex, { height: Math.max(1, v) });
    });
    row.appendChild(grid);
    return row;
  }

  private renderDiffList(state: ResizerState): void {
    if (
      state.edits.size === 0 &&
      state.bodyEdits.size === 0 &&
      state.attackEdits.size === 0 &&
      state.newAttackEdits.size === 0
    ) {
      this.diffList.textContent = 'No pending edits.';
      this.diffList.style.color = '#666';
      return;
    }
    this.diffList.style.color = '#c0c0c0';
    const lines: string[] = [];
    if (state.edits.size > 0) {
      lines.push(`${state.edits.size} animation(s) modified`);
      for (const [fullKey, edit] of state.edits) {
        const parts: string[] = [];
        if (edit.displayScale !== undefined)
          parts.push(`scale=${edit.displayScale.toFixed(2)}`);
        if (edit.anchorX !== undefined) parts.push(`anchorX=${edit.anchorX}`);
        if (edit.anchorY !== undefined) parts.push(`anchorY=${edit.anchorY}`);
        lines.push(`  ${fullKey}: ${parts.join(', ')}`);
      }
    }
    if (state.bodyEdits.size > 0) {
      lines.push(`${state.bodyEdits.size} physicsBody modified`);
      for (const [identifier, edit] of state.bodyEdits) {
        const parts: string[] = [];
        if (edit.width !== undefined) parts.push(`width=${edit.width}`);
        if (edit.height !== undefined) parts.push(`height=${edit.height}`);
        lines.push(`  ${identifier}: ${parts.join(', ')}`);
      }
    }
    if (state.attackEdits.size > 0) {
      lines.push(`${state.attackEdits.size} hitbox(es) modified`);
      for (const [key, edit] of state.attackEdits) {
        const parts: string[] = [];
        if (edit.offsetX !== undefined) parts.push(`x=${edit.offsetX}`);
        if (edit.offsetY !== undefined) parts.push(`y=${edit.offsetY}`);
        if (edit.width !== undefined) parts.push(`w=${edit.width}`);
        if (edit.height !== undefined) parts.push(`h=${edit.height}`);
        lines.push(`  ${key}: ${parts.join(', ')}`);
      }
    }
    if (state.newAttackEdits.size > 0) {
      lines.push(`${state.newAttackEdits.size} new attack(s) pending`);
      for (const [key, edit] of state.newAttackEdits) {
        const parsed = parseNewAttackEditKey(key);
        if (!parsed) continue;
        lines.push(
          `  ${parsed.identifier} → ${edit.animation} @ frame ${edit.frame} (${edit.width}×${edit.height} @ ${edit.offsetX},${edit.offsetY})`,
        );
      }
    }
    this.diffList.textContent = lines.join('\n');
    this.diffList.style.whiteSpace = 'pre-wrap';
  }

  private wireEvents(): void {
    const onScale = (raw: string) => {
      const fullKey = this.currentState?.selectedKey;
      if (!fullKey) return;
      const value = clampNumber(parseFloat(raw), 0.1, 4);
      this.callbacks.onPatch(fullKey, { displayScale: value });
    };
    this.scaleRange.addEventListener('input', () =>
      onScale(this.scaleRange.value),
    );
    this.scaleNumber.addEventListener('change', () =>
      onScale(this.scaleNumber.value),
    );

    const onAnchorX = (raw: string) => {
      const fullKey = this.currentState?.selectedKey;
      if (!fullKey) return;
      const listing = this.listingByKey.get(fullKey);
      if (!listing) return;
      const value = clampInt(parseFloat(raw), 0, listing.anim.frames.frameWidth);
      this.callbacks.onPatch(fullKey, { anchorX: value });
    };
    this.anchorXRange.addEventListener('input', () =>
      onAnchorX(this.anchorXRange.value),
    );
    this.anchorXNumber.addEventListener('change', () =>
      onAnchorX(this.anchorXNumber.value),
    );

    const onAnchorY = (raw: string) => {
      const fullKey = this.currentState?.selectedKey;
      if (!fullKey) return;
      const listing = this.listingByKey.get(fullKey);
      if (!listing) return;
      const value = clampInt(parseFloat(raw), 0, listing.anim.frames.frameHeight);
      this.callbacks.onPatch(fullKey, { anchorY: value });
    };
    this.anchorYRange.addEventListener('input', () =>
      onAnchorY(this.anchorYRange.value),
    );
    this.anchorYNumber.addEventListener('change', () =>
      onAnchorY(this.anchorYNumber.value),
    );

    const onBodyWidth = (raw: string) => {
      const identifier = this.currentIdentifier();
      if (!identifier) return;
      const value = clampInt(parseFloat(raw), 1, 4096);
      this.callbacks.onPatchBody(identifier, { width: value });
    };
    const onBodyHeight = (raw: string) => {
      const identifier = this.currentIdentifier();
      if (!identifier) return;
      const value = clampInt(parseFloat(raw), 1, 4096);
      this.callbacks.onPatchBody(identifier, { height: value });
    };
    this.bodyWidthNumber.addEventListener('change', () =>
      onBodyWidth(this.bodyWidthNumber.value),
    );
    this.bodyHeightNumber.addEventListener('change', () =>
      onBodyHeight(this.bodyHeightNumber.value),
    );

    this.resetAnimBtn.addEventListener('click', () => {
      const fullKey = this.currentState?.selectedKey;
      if (!fullKey) return;
      this.callbacks.onResetAnimation(fullKey);
    });

    this.copyScaleBtn.addEventListener('click', () => {
      const fullKey = this.currentState?.selectedKey;
      if (!fullKey) return;
      const listing = this.listingByKey.get(fullKey);
      if (!listing) return;
      const edit = this.currentState?.edits.get(fullKey);
      const resolved = resolveValues(listing, edit);
      this.callbacks.onCopyScaleToRegistry(
        listing.registry.id,
        resolved.displayScale,
      );
    });

    this.applyAnchorsBtn.addEventListener('click', () => {
      const fullKey = this.currentState?.selectedKey;
      if (!fullKey) return;
      const listing = this.listingByKey.get(fullKey);
      if (!listing) return;
      const edit = this.currentState?.edits.get(fullKey);
      const resolved = resolveValues(listing, edit);
      this.callbacks.onApplyAnchorsToUnset(
        listing.registry.id,
        resolved.anchorXIsExplicit ? resolved.anchorX : null,
        resolved.anchorYIsExplicit ? resolved.anchorY : null,
      );
    });

    this.resetAllBtn.addEventListener('click', () => {
      this.callbacks.onResetAll();
    });
    this.saveBtn.addEventListener('click', () => {
      this.callbacks.onSave();
    });
  }

  private currentIdentifier(): string | null {
    const fullKey = this.currentState?.selectedKey;
    if (!fullKey) return null;
    const listing = this.listingByKey.get(fullKey);
    return listing?.entityIdentifier ?? null;
  }

  private makeNumberOnlyRow(
    label: string,
    min: number,
  ): { row: HTMLDivElement; number: HTMLInputElement } {
    const row = document.createElement('div');
    row.style.cssText =
      'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size: 11px; color: #aaa; min-width: 50px;';
    row.appendChild(labelEl);
    const number = document.createElement('input');
    number.type = 'number';
    number.min = String(min);
    number.step = '1';
    number.style.cssText =
      'width: 80px; background: #1e1e1e; color: #ddd; border: 1px solid #333; padding: 2px 4px;';
    row.appendChild(number);
    return { row, number };
  }

  private makeRow(
    label: string,
    min: number,
    max: number,
    step: number,
  ): {
    row: HTMLDivElement;
    range: HTMLInputElement;
    number: HTMLInputElement;
  } {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 12px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText =
      'display: block; font-size: 11px; color: #aaa; margin-bottom: 4px;';
    row.appendChild(labelEl);

    const controls = document.createElement('div');
    controls.style.cssText =
      'display: flex; gap: 8px; align-items: center;';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.style.flex = '1';

    const number = document.createElement('input');
    number.type = 'number';
    number.min = String(min);
    number.max = String(max);
    number.step = String(step);
    number.style.cssText =
      'width: 64px; background: #1e1e1e; color: #ddd; border: 1px solid #333; padding: 2px 4px;';

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

  private makeButton(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = [
      'display: block',
      'width: 100%',
      'margin-top: 6px',
      'padding: 6px 8px',
      'background: #1e1e1e',
      'color: #ddd',
      'border: 1px solid #333',
      'cursor: pointer',
      'font-size: 12px',
      'text-align: left',
    ].join(';');
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#2a2a2a';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#1e1e1e';
    });
    return btn;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.round(Math.max(min, Math.min(max, value)));
}
