import Phaser from 'phaser';
import { INTERACTION_RANGE_SQ } from '../constants';
import { rollDrop } from './AmmoDrop';
import type { AmmoDropSpawnerScene } from './AmmoDropSpawnerScene';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';
import { isChestOpened, recordChestOpened } from '../state/runProgress';

// Source-px gap between the chest's body.top and the E icon anchor point.
// Pulls the anchor a touch above the lid silhouette so the icon doesn't sit
// flush against the closed-pose chest art.
const ICON_ANCHOR_GAP_PX = 2;

// Treasure chest that stays frozen on frame 0 until the player completes a
// hold-E interaction (driven by InteractionManager). AnimatedEntity's
// constructor starts the default animation with a random phase offset
// (suitable for ambient loops); for chests we override that to a closed-pose
// idle so the open animation can later be replayed from the start. On
// interact, the full open clip plays once and the chest becomes permanently
// non-interactable. The opened state is recorded in runProgress (keyed by the
// LDtk entity iid) so it survives the world rebuilds that death/respawn and HMR
// perform — a looted chest stays open (rendered on its final frame) for the
// rest of the run, resetting only on New Game / Quit (resetRunProgress).
export class Chest extends AnimatedEntity implements Interactable {
  private readonly iid: string;
  private opened = false;
  private opening = false;

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
    // A chest opened earlier this run must stay open across the world rebuilds
    // that death/respawn (and HMR) perform — runProgress.openedChests survives
    // those rebuilds (keyed by LDtk iid). Restore the opened pose by settling
    // on the open clip's final frame and locking interaction, WITHOUT replaying
    // the animation or re-rolling drops (the player already looted this chest).
    if (isChestOpened(iid)) {
      this.opened = true;
      this.setFrame(this.openedFrameIndex());
    } else {
      this.setFrame(0);
    }
  }

  // Last frame index of the open animation — the resting pose the clip halts on
  // (registry loops:false). Used to render a pre-opened chest on its open frame
  // without playing the clip through.
  private openedFrameIndex(): number {
    const anim = this.config.animations[this.config.defaultAnimation];
    return Math.max(0, anim.frameCount - 1);
  }

  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
  }

  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  canInteract(): boolean {
    return !this.opened && !this.opening;
  }

  onInteract(): void {
    if (!this.canInteract()) return;
    this.playChestOpen();
  }

  // Plays the chest's registry-defined open animation from frame 0. The
  // registry has loops:false, so the animation halts on the last frame and
  // ANIMATION_COMPLETE fires once — used here to flip the chest into the
  // permanently-opened state so the icon stops appearing on future passes.
  //
  // TODO: playOneShot(this.scene, 'chest_open') once the audio registry has
  // a chest_open entry. The audio system already supports playOneShot(scene,
  // id); only the asset + registry binding are missing.
  private playChestOpen(): void {
    this.opening = true;
    const animKey = entityAnimFullKey(
      this.getIdentifier(),
      this.config.defaultAnimation,
    );
    this.play(animKey);
    // `.once` so a future HMR teardown that destroys the chest mid-anim
    // doesn't leave a dangling listener — Phaser also auto-removes on
    // sprite destroy, but the explicit one-shot keeps the intent clear.
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.opening = false;
      this.opened = true;
      // Persist the open across world rebuilds so the chest stays open for the
      // rest of the run (death/respawn re-spawns it from the LDtk file).
      recordChestOpened(this.iid);
      this.maybeSpawnAmmoDrop();
    });
  }

  // Rolls each entry in the chest's `drops` array (if any) and asks the scene
  // to spawn a pickup per successful roll. Spawn Y at body.top so drops appear
  // at the chest opening; the AmmoDrop's initial upward velocity + per-drop
  // random X jitter pop multi-drop spawns apart so they don't stack.
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
