/**
 * result.ts
 *
 * A tiny, dependency-free Result type used across module interfaces so callers
 * handle failure explicitly instead of relying on thrown exceptions for
 * expected error paths (policy denials, entitlement failures, validation).
 *
 * Unexpected/programmer errors should still throw (see errors.ts).
 */

import type { AppError } from "./errors";

export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Wrap a success value. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap a failure value. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Narrowing helper: true when the result is a success. */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { ok: true; value: T } {
  return result.ok;
}
