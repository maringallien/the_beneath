/**
 * @file shared/validate.ts
 * @description Shared field-validation primitives for the hand-rolled JSON registry loaders — `require*` forms demand a field, `optional*` forms allow it missing but reject a present-but-wrong value; the pervasive `obj`/`field`/`ctx` trio (parent record, field name, JSON path used verbatim in errors) recurs across every helper, so a miss names the exact bad path and fails the boot loudly at module load. Domain rules stay in the loaders.
 * @module shared
 */

/**
 * @function    fail
 * @description Throws a path-tagged error naming what was expected vs. what was found.
 * @param   requirement  Expected shape in prose, embedded in the message.
 * @param   value        The offending value, JSON-stringified into the message.
 * @returns never — always throws an Error.
 * @calledby src/shared/validate.ts → every require/optional helper below, on a validation miss
 * @calls    the Error constructor only; no further delegation
 */
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

/**
 * @function    requireObject
 * @description Asserts the value is a plain object (not null, not an array).
 * @param   raw  Parsed-JSON value under test.
 * @returns the value narrowed to Record<string, unknown>; throws otherwise.
 * @calledby widely used — the registry loaders, before reading any field off a node
 * @calls    throws an Error inline on a type miss; no other delegation
 */
export function requireObject(
  raw: unknown,
  ctx: string,
): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(`${ctx} must be an object`);
  }
  return raw as Record<string, unknown>;
}

/**
 * @function    requireArray
 * @description Asserts the value is an array (may be empty).
 * @param   raw  Parsed-JSON value under test.
 * @returns the value as unknown[]; throws otherwise.
 * @calledby widely used — the registry loaders, before iterating a list field
 * @calls    throws an Error inline on a type miss; no other delegation
 */
export function requireArray(raw: unknown, ctx: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${ctx} must be an array`);
  }
  return raw;
}

/**
 * @function    requireNonEmptyArray
 * @description Asserts the value is an array with at least one element.
 * @param   raw  Parsed-JSON value under test.
 * @returns the value as unknown[]; throws on a non-array or empty array.
 * @calledby widely used — the registry loaders, for lists that must carry at least one entry
 * @calls    throws an Error inline on a miss; no other delegation
 */
export function requireNonEmptyArray(raw: unknown, ctx: string): unknown[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${ctx} must be a non-empty array`);
  }
  return raw;
}

/**
 * @function    requireString
 * @description Reads a required non-empty string field.
 * @returns the string; throws via fail() if absent/empty/non-string.
 * @calledby widely used — the registry loaders, for mandatory text fields (ids, keys)
 * @calls    src/shared/validate.ts → fail on a miss
 */
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

/**
 * @function    optionalString
 * @description Reads an optional string — undefined if absent, error if present-but-empty.
 * @returns string | undefined; throws via fail() on a present-but-wrong value.
 * @calledby widely used — the registry loaders, for optional text fields
 * @calls    src/shared/validate.ts → fail on a present-but-invalid value
 */
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

/**
 * @function    requireBoolean
 * @description Reads a required boolean field (no truthy coercion).
 * @returns the boolean; throws via fail() if absent or non-boolean.
 * @calledby widely used — the registry loaders, for mandatory flag fields
 * @calls    src/shared/validate.ts → fail on a miss
 */
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

/**
 * @function    optionalBoolean
 * @description Reads an optional boolean — undefined if absent, error if present-but-not-boolean.
 * @returns boolean | undefined; throws via fail() on a present-but-wrong value.
 * @calledby widely used — the registry loaders, for optional flag fields
 * @calls    src/shared/validate.ts → fail on a present-but-invalid value
 */
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

/**
 * @function    requireFinite
 * @description Reads a required finite number (any sign incl. zero; rejects NaN/±Infinity).
 * @returns the number; throws via fail() on a non-finite/absent value.
 * @calledby widely used — the registry loaders, for numeric fields with no sign constraint
 * @calls    src/shared/validate.ts → fail on a miss
 */
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

/**
 * @function    optionalFinite
 * @description Reads an optional finite number — undefined if absent.
 * @returns number | undefined; throws via fail() on a present-but-non-finite value.
 * @calledby widely used — the registry loaders, for optional unconstrained-sign numbers
 * @calls    src/shared/validate.ts → fail on a present-but-invalid value
 */
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

/**
 * @function    requirePositive
 * @description Reads a required positive number (strictly > 0; zero rejected).
 * @returns the number; throws via fail() on a non-positive/absent value.
 * @calledby widely used — the registry loaders, for magnitudes that must exceed zero
 * @calls    src/shared/validate.ts → fail on a miss
 */
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

/**
 * @function    optionalPositive
 * @description Reads an optional positive number — undefined if absent.
 * @returns number | undefined; throws via fail() on a present-but-non-positive value.
 * @calledby widely used — the registry loaders, for optional strictly-positive magnitudes
 * @calls    src/shared/validate.ts → fail on a present-but-invalid value
 */
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

/**
 * @function    requireNonNegative
 * @description Reads a required non-negative number (≥ 0; zero allowed).
 * @returns the number; throws via fail() on a negative/absent value.
 * @calledby widely used — the registry loaders, for magnitudes where zero is meaningful
 * @calls    src/shared/validate.ts → fail on a miss
 */
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

/**
 * @function    optionalNonNegative
 * @description Reads an optional non-negative number — undefined if absent.
 * @returns number | undefined; throws via fail() on a present-but-negative value.
 * @calledby widely used — the registry loaders, for optional zero-allowed magnitudes
 * @calls    src/shared/validate.ts → fail on a present-but-invalid value
 */
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

/**
 * @function    requireNonNegativeInt
 * @description Reads a required non-negative integer (whole, ≥ 0; for counts and indices).
 * @returns the integer; throws via fail() on a non-integer/negative/absent value.
 * @calledby widely used — the registry loaders, for whole-number counts and indices
 * @calls    src/shared/validate.ts → fail on a miss
 */
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

/**
 * @function    optionalNonNegativeInt
 * @description Reads an optional non-negative integer — undefined if absent.
 * @returns number | undefined; throws via fail() on a present-but-invalid value.
 * @calledby widely used — the registry loaders, for optional whole-number counts/indices
 * @calls    src/shared/validate.ts → fail on a present-but-invalid value
 */
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

/**
 * @function    requirePositiveInt
 * @description Reads a required positive integer (whole, strictly > 0; for at-least-one counts).
 * @returns the integer; throws via fail() on a non-integer/non-positive/absent value.
 * @calledby widely used — the registry loaders, for counts that must be at least one
 * @calls    src/shared/validate.ts → fail on a miss
 */
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

/**
 * @function    optionalPositiveInt
 * @description Reads an optional positive integer — undefined if absent.
 * @returns number | undefined; throws via fail() on a present-but-invalid value.
 * @calledby widely used — the registry loaders, for optional at-least-one counts
 * @calls    src/shared/validate.ts → fail on a present-but-invalid value
 */
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

/**
 * @function    optionalFraction
 * @description Reads an optional fraction strictly inside (0, 1) — omit the field to mean "never"/"always" rather than passing 0 or 1.
 * @returns number | undefined; throws via fail() on a value outside (0, 1) exclusive.
 * @calledby widely used — the registry loaders, for probability/ratio fields
 * @calls    src/shared/validate.ts → fail on a present-but-out-of-range value
 */
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

/**
 * @function    requireOneOf
 * @description Reads a required string-enum field; the error lists the allowed options so a typo is obvious.
 * @param   allowed  The permitted values, as an array or set.
 * @returns the value narrowed to the enum type T; throws via fail() if not allowed.
 * @calledby widely used — the registry loaders, for discriminant/kind fields with a fixed vocabulary
 * @calls    src/shared/validate.ts → fail on a miss
 */
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
