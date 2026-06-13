# Commenting & Documentation Standard — *The Beneath*

The one contract for comments in `src/`. Every file and every reviewer follows it.
Reference implementations: [`src/entities/enemyLeapProbes.ts`](../src/entities/enemyLeapProbes.ts)
(standalone module), [`src/entities/Door.ts`](../src/entities/Door.ts) (class with
trivial + substantial methods), [`src/constants/player.ts`](../src/constants/player.ts)
(data/constants).

## The tiered rule

1. **Every file** opens with a **file header** (Template A), placed after the imports.
2. **Every substantial function/method** gets a **full JSDoc header** (Template B).
3. **Trivial functions** (getters, predicates, one-liners) get a **single-line `//`** (Template C).
4. **Data/constants & pure-type files** get a file header **plus a `//` per export** — no
   per-symbol JSDoc theater (there are no real functions to document).

**Substantial vs trivial test** — *substantial* = has branching, side effects, a non-obvious
contract, or encodes domain/game mechanics. *Trivial* = returns a field, evaluates a simple
boolean, or is a one-line pure expression.

## Format

JSDoc `/** … */`. Standard `@param` / `@returns`, plus two project tags:

- **`@calledby`** — prose describing the *scenario/context that triggers this code*.
- **`@calls`** — prose describing *what it delegates to downstream and the effect*.

> **`@calledby` / `@calls` never name specific functions.** Describe the situation and the
> downstream system by role, so the line stays true across refactors and reads for a human.
> ✅ `@calledby the boss damage path, when a non-lethal hit crosses a round threshold`
> ❌ `@calledby takeDamage()`

For Phaser-invoked methods (`update`, `preUpdate`, constructors), say so in prose —
e.g. `@calledby the scene's per-frame update loop` — don't hunt for an app-code caller.

## Brevity (the "not excessive" discipline)

- Keep each field to tight prose; no padding. A header should be scannable, not an essay.
- **Skip `@param` for a context/handle parameter** that's documented at the file level and
  repeats across the module (e.g. the `probe: LeapProbeContext` handle). Document the params
  that *vary* and carry meaning (units, ranges, null-semantics).
- Skip `@returns` on `void`; let an obvious return speak for itself.
- A full header on a *trivial* function is excessive — use Template C instead.

## The condensing rule (kill the huge inline blocks)

Big multi-line prose blocks sitting **inside** function bodies or between methods must be
**distilled into the header description + at most a couple of brief inline `//` notes** at the
load-bearing lines. **Preserve every distinct domain fact** — if unsure whether a sentence is
load-bearing, keep it as a short inline `//` rather than dropping it. Bulk goes; knowledge stays.
Canonical "before": `src/scenes/trapSystem.ts` (the ~24-line trap-overlap block).

## Behavior-only rule

These passes change **comments only**. Never alter a code token, import order, or whitespace
on a code line. Never disturb a directive comment (`@ts-ignore` etc.; currently none exist —
keep it that way). Gotcha: arrow-property methods
(`onPlayerHitsTrap: …Callback = (…) => {…}`) take the JSDoc **above the property assignment**.

## Templates

### A — File header (after imports)
```ts
/**
 * <FileName> — <one-line role in the system>.
 *
 * <2–4 sentences: what this module/class owns, the mechanic it implements, any
 *  invariant the reader must hold.>
 *
 * Inputs:  <what it consumes — scene refs, configs, registry data, events>.
 * Outputs: <what it produces / mutates — sprites, sounds, state, returns>.
 * @calledby <prose: the scenarios that pull this module in>.
 * @calls    <prose: the downstream systems it reaches and their effects>.
 */
```

### B — Substantial function/method
```ts
/**
 * <Imperative one-liner.> <1–3 sentences on WHY / the mechanic / edge cases —
 *  this is where condensed inline prose lands.>
 *
 * @param <name> <meaning + units/range/null-semantics where non-obvious>
 * @returns <meaning incl. the null/empty case>
 * @calledby <prose scenario + the condition that triggers this path; NO names>
 * @calls    <prose: what it triggers downstream and the effect; NO names>
 */
```

### C — Trivial getter / predicate / one-liner
```ts
// Current hit points (live, not max).
getHealth(): number { return this.health; }
```

## Verification (run per batch)

```bash
node tools/verify-comments-only.mjs snapshot <file...>   # BEFORE editing the batch
# ...document the files...
node tools/verify-comments-only.mjs check    <file...>   # AFTER  editing the batch
npm run type-check                                       # tsc --noEmit must stay green
```

`verify-comments-only.mjs` snapshots each file's bytes before editing, then transpiles the
snapshot and the edited copy with comments stripped and asserts the emitted code is
identical. The snapshot lives under the system temp dir, so it works even on a file that
already carries unrelated uncommitted edits (it isolates *this* pass's changes) and never
touches git.

## Per-file checklist (gradeable)

- [ ] File header present (Template A), placed after imports.
- [ ] Every substantial function has `@param` (non-obvious params) / `@returns` (non-void) /
      `@calledby` / `@calls`.
- [ ] No `@calledby` / `@calls` names a specific function.
- [ ] Trivial functions use a single `//` line, not a full header.
- [ ] No 5+ line prose block remains inside a function body (condensed).
- [ ] No code token changed (`node tools/verify-comments-only.mjs` → PASS) and `tsc` green.
