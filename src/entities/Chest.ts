import Phaser from 'phaser';
import { INTERACTION_RANGE_SQ } from '../constants';
import { rollDrop } from './AmmoDrop';
import type { AmmoDropSpawnerScene } from './AmmoDropSpawnerScene';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';
import { isChestOpened, recordChestOpened } from '../state/runProgress';

// gap so the icon floats just above the lid silhouette rather than flush against it
const ICON_ANCHOR_GAP_PX = 2;

/**
 * Chest — the interactable treasure chest.
 *
 * Sits frozen on frame 0 until the player completes a hold-E (driven by the
 * interaction manager), then plays its open clip once and becomes permanently
 * non-interactable, rolling any configured drops on completion. The base
 * constructor's random-phase default is overridden to a fixed closed pose so the
 * open clip can replay cleanly from the start. The opened state is persisted in
 * the run-progress store keyed by LDtk iid, so it survives the world rebuilds
 * that death/respawn and HMR perform: a looted chest stays open (rendered on its
 * final frame) for the rest of the run and resets only on New Game / Quit.
 *
 * Inputs:  scene + spawn x/y, registry identifier, and the LDtk iid; the
 *          interaction manager polls the contract methods; persisted opened-set.
 * Outputs: drives its own open animation, records the open in run-progress, and
 *          asks the scene to spawn drop pickups.
 * @calledby the gameplay scene — spawned at level load and driven by the
 *           hold-to-interact system when the player is in range.
 * @calls    the entity animation helper, the run-progress chest-open store, the
 *           drop roller, and the scene's ammo-drop spawner.
 */
export class Chest extends AnimatedEntity implements Interactable {
  private readonly iid: string;
  private opened = false;
  private opening = false;

  // restores a previously-looted chest to its open frame; a fresh chest rests on frame 0
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    identifier: string,
    iid: string,
  ) {
    super(scene, x, y, identifier);
    this.iid = iid;
    this.anims.stop();
    if (isChestOpened(iid)) {
      this.opened = true;
      this.setFrame(this.openedFrameIndex());
    } else {
      this.setFrame(0);
    }
  }

  // last frame of the open clip — the pose a pre-opened chest rests on without replaying
  private openedFrameIndex(): number {
    const anim = this.config.animations[this.config.defaultAnimation];
    return Math.max(0, anim.frameCount - 1);
  }

  // Where the hold-E prompt icon floats: centered just above the chest's top.
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
  }

  // Squared player-distance within which the E prompt is offered.
  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  // Offer the prompt only while closed and not mid-open; an opened chest is done.
  canInteract(): boolean {
    return !this.opened && !this.opening;
  }

  // On a completed hold (and only if still openable), starts the open sequence.
  onInteract(): void {
    if (!this.canInteract()) return;
    this.playChestOpen();
  }

  // TODO: playOneShot(this.scene, 'chest_open') once the audio registry has
  // a chest_open entry. The audio system already supports playOneShot; only asset+registry wiring is missing.
  // plays the open clip once; on completion marks opened, persists, and rolls drops
  private playChestOpen(): void {
    this.opening = true;
    const animKey = entityAnimFullKey(
      this.getIdentifier(),
      this.config.defaultAnimation,
    );
    this.play(animKey);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.opening = false;
      this.opened = true;
      recordChestOpened(this.iid);
      this.maybeSpawnAmmoDrop();
    });
  }

  // rolls each configured drop and spawns any successful results at body.top
  private maybeSpawnAmmoDrop(): void {
    const drops = this.config.drops;
    if (!drops || drops.length === 0) return;
    const spawner = this.scene as unknown as AmmoDropSpawnerScene;
    for (const dropConfig of drops) {
      const kind = rollDrop(dropConfig);
      if (!kind) continue;
      spawner.spawnAmmoDrop(kind, this.x, this.body.top);
    }
  }
}
