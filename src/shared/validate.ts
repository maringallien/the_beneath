// Shared primitives for the hand-rolled JSON registry validators
// (entityRegistryLoader, soundRegistryLoader, animationSoundTriggersLoader).
//
// Every field helper takes the parent record, the field name, and a `ctx`
// path string used verbatim in the error message, so a failure names the
// exact JSON path that's wrong (e.g. `entityRegistry["Crow"].attack.damage
// must be a positive number (got -3)`). The registries validate at module
// load, so a bad value fails the boot loudly instead of misbehaving at
// first spawn.
//
// Only the primitives live here. Domain rules (cross-references between
// fields, animation-key existence, range relationships like minRange <
// range) stay in the loaders next to the schema they describe.

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

export function requireObject(
  raw: unknown,
  ctx: string,
): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(`${ctx} must be an object`);
  }
  return raw as Record<string, unknown>;
}

export function requireArray(raw: unknown, ctx: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${ctx} must be an array`);
  }
  return raw;
}

export function requireNonEmptyArray(raw: unknown, ctx: string): unknown[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${ctx} must be a non-empty array`);
  }
  return raw;
}

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

// Open interval (0, 1) — both ends exclusive. For ratio knobs like heal
// thresholds where 0 would mean "never" and 1 "always" (express those by
// omitting the field, not by degenerate values).
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
