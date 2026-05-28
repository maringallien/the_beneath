import Phaser from 'phaser';
import {
  INTERACTION_HOLD_DURATION_MS,
  INTERACTION_ICON_FADE_RATE,
  INTERACTION_ICON_OFFSET_Y_PX,
} from '../constants';
import { InteractionIcon } from './InteractionIcon';
import type { Interactable } from './Interactable';

// Below this alpha the icon is invisible enough to hide outright — skips
// per-frame setVisible(true)/Graphics paint cost when nothing's in range.
const ALPHA_VISIBILITY_EPSILON = 0.005;

// Structural interface so InteractionManager doesn't import the full Player
// class. Player implements this by exposing isInteractionBlocked() — see
// Player.ts. Keeps the dependency one-directional (Player has no awareness of
// the interaction system) and avoids an import cycle.
export interface InteractionPlayerQuery {
  readonly x: number;
  readonly y: number;
  isInteractionBlocked(): boolean;
}

// Per-scene orchestrator for hold-E interactions. Owns the E key, the single
// shared world-anchored icon, and a registry of Interactable targets.
// Each frame:
//   1. Pick the closest in-range, canInteract() target.
//   2. Reset hold progress on target change.
//   3. If E is down and the player isn't locked, advance the hold timer.
//   4. On hold completion, dispatch onInteract() exactly once per press.
//   5. Drive the icon's position, fade, and progress ring.
//
// Built/destroyed by GameScene's buildWorld/tearDownWorld so HMR rebuilds the
// manager along with the rest of the world — no orphaned listeners or icon.
export class InteractionManager {
  private readonly scene: Phaser.Scene;
  private readonly player: InteractionPlayerQuery;
  private readonly keyE: Phaser.Input.Keyboard.Key;
  private readonly icon: InteractionIcon;
  private readonly targets: Interactable[] = [];

  // Closest in-range interactable this frame, or null when nothing is near.
  // Switching this nulls out the hold timer (you can't carry partial progress
  // from one chest to another).
  private current: Interactable | null = null;

  // Eased toward (current ? 1 : 0) per frame. Linear approach so the fade
  // works the same on every frame rate — no tween objects to leak on HMR.
  private currentAlpha = 0;

  // Accumulated hold-down time against `current`, in ms. Cleared whenever
  // the current target changes, E is released, the player enters a locked
  // action, or an interaction fires.
  private holdMs = 0;

  // Latched true on the frame an interaction fires; stays true until E is
  // released. Prevents the same press from re-firing on the next chest if
  // the player walks into a new target while still holding the key down.
  private triggered = false;

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

  register(target: Interactable): void {
    this.targets.push(target);
  }

  registerAll(targets: Iterable<Interactable>): void {
    for (const t of targets) {
      this.targets.push(t);
    }
  }

  // Per-frame tick. Called from GameScene.update() after the player has
  // updated (so playerX/playerY reflect this frame's resolved position) and
  // before HUD repaints (so the icon's position lands in the same camera
  // matrix the HUD reads).
  update(playerX: number, playerY: number, deltaMs: number): void {
    const next = this.pickClosest(playerX, playerY);

    if (next !== this.current) {
      // Target change (including to/from null) drops in-flight progress.
      // The triggered latch persists so a key held across the swap still
      // can't double-fire — only releasing E clears it (see below).
      this.current = next;
      this.holdMs = 0;
    }

    const eDown = this.keyE.isDown;
    if (!eDown) {
      // Releasing E always resets both the timer and the trigger latch, so
      // the next press starts clean against whatever the current target is.
      this.holdMs = 0;
      this.triggered = false;
    }

    if (this.current && eDown && !this.triggered) {
      // Locked-action gate: icon still fades in (the player sees what they'd
      // interact with after the swing finishes) but the hold timer doesn't
      // advance. Matches the spec's separation of "register" feedback from
      // "trigger" feedback.
      if (!this.player.isInteractionBlocked()) {
        this.holdMs += deltaMs;
        if (this.holdMs >= INTERACTION_HOLD_DURATION_MS) {
          const target = this.current;
          this.triggered = true;
          this.holdMs = 0;
          target.onInteract();
          // Re-check canInteract() immediately so a single-use entity falls
          // out of the closest-target search on the very next frame and the
          // icon doesn't briefly linger on a consumed target.
          if (!target.canInteract()) {
            this.current = null;
          }
        }
      } else {
        // While locked, never accumulate progress — releasing the lock
        // would otherwise instantly trigger.
        this.holdMs = 0;
      }
    }

    // Alpha lerp toward target. Linear approach using deltaMs so the fade
    // duration is frame-rate independent.
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
    // Progress ratio reflects the current hold against the constant
    // duration. Sits at 0 between presses and while the player is locked.
    this.icon.setProgress(this.holdMs / INTERACTION_HOLD_DURATION_MS);
  }

  destroy(): void {
    this.scene.input.keyboard?.removeKey(this.keyE);
    this.icon.destroy();
    this.targets.length = 0;
    this.current = null;
  }

  // Linear scan over registered targets — one allocation-free pass per
  // frame. Skips !canInteract() so consumed entities fall out naturally.
  // Range gating is per-target (each Interactable returns its own squared
  // range) so a future wide-range NPC doesn't force a global constant
  // change.
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
