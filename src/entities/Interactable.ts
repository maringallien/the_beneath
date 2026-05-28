// Generic "hold E to interact" contract. Any entity that opts in by
// implementing this interface gets picked up by InteractionManager — no per-
// entity wiring in GameScene. A structural interface (not a base class) keeps
// Chest free to extend AnimatedEntity while still being addressable as an
// interactable. Add new interactables by implementing the interface and
// registering them via InteractionManager.register / .registerAll.

export interface Interactable {
  // World-space coords used both for proximity tests and for anchoring the
  // E icon (the icon renders above this point by INTERACTION_ICON_OFFSET_Y_PX).
  // For sprites this is typically (sprite.x, body.top - small gap).
  getInteractionAnchor(): { readonly x: number; readonly y: number };

  // Squared form so the manager's per-frame closest-target scan can avoid a
  // sqrt. Most entities return INTERACTION_RANGE_SQ from constants; an entity
  // with a wider trigger (e.g. a future NPC at 80 px) returns its own value.
  getInteractionRangeSq(): number;

  // False once the entity has been "used up" (e.g. an opened chest) or while
  // mid-animation transition. The manager skips !canInteract() targets in its
  // closest-target search and hides the icon if the current target's gate
  // flips false mid-hold.
  canInteract(): boolean;

  // Fires when the player completes the hold. The entity owns all side effects
  // (play anim, change state, emit SFX). The manager re-checks canInteract()
  // immediately after dispatch so a single-use entity falls out of the icon
  // selection without any extra bookkeeping by the caller.
  onInteract(): void;
}

// Type guard for narrowing arbitrary GameObjects to Interactable. Reserved for
// places that hold a heterogeneous list (e.g. spawned.others) — when an array
// is already typed as ReadonlyArray<Interactable> from EntityFactory the guard
// isn't needed.
export function isInteractable(obj: unknown): obj is Interactable {
  if (obj == null || typeof obj !== 'object') return false;
  const candidate = obj as Record<string, unknown>;
  return (
    typeof candidate.getInteractionAnchor === 'function' &&
    typeof candidate.getInteractionRangeSq === 'function' &&
    typeof candidate.canInteract === 'function' &&
    typeof candidate.onInteract === 'function'
  );
}
