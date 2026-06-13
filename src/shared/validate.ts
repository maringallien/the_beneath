/**
 * validate — shared primitives for the hand-rolled JSON registry validators
 * (entity registry, sound registry, animation-sound-triggers loaders).
 *
 * Every field helper takes the parent record, the field name, and a `ctx` path
 * string used verbatim in the error message, so a failure names the exact JSON
 * path that's wrong (e.g. `entityRegistry["Crow"].attack.damage must be a
 * positive number (got -3)`). The `require*` forms demand the field; the
 * `optional*` forms accept a missing field (return undefined) but still reject a
 * present-but-wrong value. The registries validate at module load, so a bad value
 * fails the boot loudly instead of misbehaving at first spawn.
 *
 * Only the primitives live here. Domain rules (cross-references between fields,
 * animation-key existence, range relationships like minRange < range) stay in the
 * loaders next to the schema they describe.
 *
 * Inputs:  a parsed-JSON record/value, a field name, and a `ctx` path string.
 * Outputs: the narrowed, typed value — or a thrown Error naming the bad path.
 * @calledby the registry loaders, field by field, while validating raw JSON.
 * @calls    the local `fail` helper, which throws the path-tagged error.
 */

// throws a path-tagged error naming exactly what was expected vs. what was found
function fail(
  ctx: string,
  field: string,
  requirement: string,
  value: unknown,
): never {
  throw new Error(
    `${ctx}.${field} must be ${requirement} (got ${JSON.stringify(value)})`,
  );
}

// asserts the value is a plain object (not null, not an array)
export function requireObject(
  raw: unknown,
  ctx: string,
): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(`${ctx} must be an object`);
  }
  return raw as Record<string, unknown>;
}

// asserts the value is an array (may be empty)
export function requireArray(raw: unknown, ctx: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${ctx} must be an array`);
  }
  return raw;
}

// asserts the value is a non-empty array
export function requireNonEmptyArray(raw: unknown, ctx: string): unknown[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${ctx} must be a non-empty array`);
  }
  return raw;
}

// reads a required non-empty string field
export function requireString(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) {
    fail(ctx, field, 'a non-empty string', value);
  }
  return value;
}

// reads an optional string — undefined if absent, error if present but empty/non-string
export function optionalString(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): string | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    fail(ctx, field, 'a non-empty string when set', value);
  }
  return value;
}

// reads a required boolean field (no truthy coercion)
export function requireBoolean(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): boolean {
  const value = obj[field];
  if (typeof value !== 'boolean') {
    fail(ctx, field, 'a boolean', value);
  }
  return value;
}

// reads an optional boolean — undefined if absent, error if present but not boolean
export function optionalBoolean(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): boolean | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    fail(ctx, field, 'a boolean when set', value);
  }
  return value;
}

// reads a required finite number (any sign including zero, no NaN/±Infinity)
export function requireFinite(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(ctx, field, 'a finite number', value);
  }
  return value;
}

// reads an optional finite number — undefined if absent
export function optionalFinite(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(ctx, field, 'a finite number when set', value);
  }
  return value;
}

// reads a required positive number (strictly > 0; zero rejected)
export function requirePositive(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(ctx, field, 'a positive number', value);
  }
  return value;
}

// reads an optional positive number — undefined if absent
export function optionalPositive(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(ctx, field, 'a positive number when set', value);
  }
  return value;
}

// reads a required non-negative number (≥ 0; zero allowed)
export function requireNonNegative(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(ctx, field, 'a non-negative number', value);
  }
  return value;
}

// reads an optional non-negative number — undefined if absent
export function optionalNonNegative(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(ctx, field, 'a non-negative number when set', value);
  }
  return value;
}

// reads a required non-negative integer (whole, ≥ 0; for counts and indices)
export function requireNonNegativeInt(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(ctx, field, 'a non-negative integer', value);
  }
  return value;
}

// reads an optional non-negative integer — undefined if absent
export function optionalNonNegativeInt(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(ctx, field, 'a non-negative integer when set', value);
  }
  return value;
}

// reads a required positive integer (whole, strictly > 0; for at-least-one counts)
export function requirePositiveInt(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(ctx, field, 'a positive integer', value);
  }
  return value;
}

// reads an optional positive integer — undefined if absent
export function optionalPositiveInt(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(ctx, field, 'a positive integer when set', value);
  }
  return value;
}

// reads an optional fraction strictly inside (0, 1) — omit the field to mean "never"/"always" instead of passing 0/1
export function optionalFraction(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): number | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value >= 1
  ) {
    fail(ctx, field, 'a number in (0, 1) exclusive when set', value);
  }
  return value;
}

// reads a required string-enum field; the error message lists the allowed options so a typo is obvious
export function requireOneOf<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
  allowed: ReadonlyArray<T> | ReadonlySet<T>,
): T {
  const options = [...allowed];
  const value = obj[field];
  if (
    typeof value !== 'string' ||
    !(options as ReadonlyArray<string>).includes(value)
  ) {
    fail(
      ctx,
      field,
      options.map((o) => JSON.stringify(o)).join(' | '),
      value,
    );
  }
  return value as T;
}
