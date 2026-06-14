import Phaser from 'phaser';
import {
  INTERACTION_HOLD_DURATION_MS,
  INTERACTION_ICON_FADE_RATE,
  INTERACTION_ICON_OFFSET_Y_PX,
} from '../constants';
import { InteractionIcon } from './InteractionIcon';
import type { Interactable } from './Interactable';

/**
 * @file entities/InteractionManager.ts
 * @description Per-scene orchestrator for hold-E interactions. Owns the E key, the single shared world-anchored icon, and a registry of Interactable targets. Each frame it picks the closest in-range canInteract() target, resets hold progress on a target change, advances the hold timer while E is down and the player isn't in a locked action, dispatches onInteract() exactly once per press on completion, and drives the icon's position, fade, and progress ring. Two latches enforce the once-per-press contract: the current-target switch clears partial progress, and the triggered latch (cleared only on E release) blocks a held key from re-firing on the next target walked into.
 * @module entities
 */

// below this alpha the icon is hidden outright to skip pointless Graphics repaints
const ALPHA_VISIBILITY_EPSILON = 0.005;

// structural player query so this module doesn't import the full Player class (avoids circular dep)
export interface InteractionPlayerQuery {
  readonly x: number;
  readonly y: number;
  isInteractionBlocked(): boolean;
}

export class InteractionManager {
  private readonly scene: Phaser.Scene;
  private readonly player: InteractionPlayerQuery;
  private readonly keyE: Phaser.Input.Keyboard.Key;
  private readonly icon: InteractionIcon;
  private readonly targets: Interactable[] = [];

  // closest in-range target this frame; switching it clears partial hold progress
  private current: Interactable | null = null;

  // linearly eased toward 1 when a target is present, 0 when absent
  private currentAlpha = 0;

  // accumulated hold time in ms; cleared on target change, E release, locked action, or fire
  private holdMs = 0;

  // latched on fire until E is released — prevents re-firing on the next target while still holding
  private triggered = false;

  /**
   * @function    constructor
   * @description Bind the E key and create the single shared interaction icon; throws if the scene has no keyboard input.
   * @param   scene   Owning Phaser scene.
   * @param   player  A structural position + isInteractionBlocked query.
   * @calledby src/scenes/GameScene.ts → when it builds the interactable world
   * @calls    the Phaser keyboard binding and the InteractionIcon constructor
   */
  constructor(scene: Phaser.Scene, player: InteractionPlayerQuery) {
    if (!scene.input.keyboard) {
      throw new Error(
        'InteractionManager: keyboard input is not available on this scene',
      );
    }
    this.scene = scene;
    this.player = player;
    this.keyE = scene.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.E,
    );
    this.icon = new InteractionIcon(scene);
  }

  /** Registers one interactable target into the per-frame closest-target search. */
  register(target: Interactable): void {
    this.targets.push(target);
  }

  /** Registers a batch of interactable targets (see register). */
  registerAll(targets: Iterable<Interactable>): void {
    for (const t of targets) {
      this.targets.push(t);
    }
  }

  /**
   * @function    update
   * @description Per-frame tick: pick the closest target, reset hold progress on a target switch, advance the hold timer while E is held and the player isn't blocked, fire onInteract once per press on completion (dropping a consumed target), then ease and redraw the icon's fade, position, and progress ring.
   * @param   playerX, playerY  Player world position.
   * @param   deltaMs           Frame delta.
   * @calledby Phaser per-frame update loop (via src/scenes/GameScene.ts → update, after the player resolves)
   * @calls    pickClosest, each target's canInteract/getInteractionAnchor/onInteract surface, and the icon's visibility/alpha/position/progress drawing
   */
  update(playerX: number, playerY: number, deltaMs: number): void {
    const next = this.pickClosest(playerX, playerY);

    if (next !== this.current) {
      // triggered latch persists across target swap so a held key can't double-fire
      this.current = next;
      this.holdMs = 0;
    }

    const eDown = this.keyE.isDown;
    if (!eDown) {
      this.holdMs = 0;
      this.triggered = false;
    }

    if (this.current && eDown && !this.triggered) {
      // locked action: icon still fades in but hold timer doesn't advance
      if (!this.player.isInteractionBlocked()) {
        this.holdMs += deltaMs;
        if (this.holdMs >= INTERACTION_HOLD_DURATION_MS) {
          const target = this.current;
          this.triggered = true;
          this.holdMs = 0;
          target.onInteract();
          // drop a consumed target immediately so the icon doesn't linger
          if (!target.canInteract()) {
            this.current = null;
          }
        }
      } else {
        this.holdMs = 0;
      }
    }

    const targetAlpha = this.current ? 1 : 0;
    const step = INTERACTION_ICON_FADE_RATE * deltaMs;
    if (this.currentAlpha < targetAlpha) {
      this.currentAlpha = Math.min(targetAlpha, this.currentAlpha + step);
    } else if (this.currentAlpha > targetAlpha) {
      this.currentAlpha = Math.max(targetAlpha, this.currentAlpha - step);
    }

    if (this.currentAlpha < ALPHA_VISIBILITY_EPSILON) {
      this.icon.setVisible(false);
      return;
    }

    this.icon.setVisible(true);
    this.icon.setAlpha(this.currentAlpha);
    if (this.current) {
      const anchor = this.current.getInteractionAnchor();
      this.icon.setWorldPosition(
        anchor.x,
        anchor.y - INTERACTION_ICON_OFFSET_Y_PX,
      );
    }
    this.icon.setProgress(this.holdMs / INTERACTION_HOLD_DURATION_MS);
  }

  /**
   * @function    destroy
   * @description Tear down the key binding, icon, and target registry on a world rebuild or HMR so nothing leaks across reloads.
   * @calledby src/scenes/GameScene.ts → when it tears down the interactable world
   * @calls    the Phaser keyboard removeKey and the icon's destroy
   */
  destroy(): void {
    this.scene.input.keyboard?.removeKey(this.keyE);
    this.icon.destroy();
    this.targets.length = 0;
    this.current = null;
  }

  /**
   * @function    pickClosest
   * @description Linear scan returning the nearest canInteract() target within its own squared range, or null when none qualify.
   * @param   playerX, playerY  The player's world position.
   * @returns the closest eligible Interactable, or null.
   * @calledby src/entities/InteractionManager.ts → update, choosing this frame's hold target
   * @calls    each target's canInteract/getInteractionAnchor/getInteractionRangeSq surface only
   */
  private pickClosest(playerX: number, playerY: number): Interactable | null {
    let best: Interactable | null = null;
    let bestDistSq = Infinity;
    for (const t of this.targets) {
      if (!t.canInteract()) continue;
      const anchor = t.getInteractionAnchor();
      const dx = anchor.x - playerX;
      const dy = anchor.y - playerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > t.getInteractionRangeSq()) continue;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = t;
      }
    }
    return best;
  }
}
