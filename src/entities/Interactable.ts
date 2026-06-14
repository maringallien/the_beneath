/**
 * @file entities/Interactable.ts
 * @description Generic "hold E to interact" contract. Any entity that implements this interface is picked up by the interaction manager with no per-entity wiring in the scene. A structural interface (not a base class) lets an entity keep its own inheritance (e.g. Chest extending AnimatedEntity) while still being addressable as an interactable. Add new interactables by implementing the interface and registering them with the interaction manager.
 * @module entities
 */

export interface Interactable {
  // World-space anchor for proximity tests and for placing the E icon.
  getInteractionAnchor(): { readonly x: number; readonly y: number };

  // Squared distance threshold — avoids a sqrt in the per-frame scan.
  getInteractionRangeSq(): number;

  // False when the entity is "used up" or mid-transition; manager skips it.
  canInteract(): boolean;

  // Called when the player completes the hold; entity owns all side effects.
  onInteract(): void;
}

/**
 * @function    isInteractable
 * @description Duck-type guard checking that an unknown value implements all four Interactable methods.
 * @param   obj  An arbitrary unknown value.
 * @returns a type predicate narrowing obj to Interactable when it matches.
 * @calledby —
 * @calls    — (pure structural checks)
 */
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
