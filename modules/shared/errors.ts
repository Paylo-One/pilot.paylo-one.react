/**
 * errors.ts
 *
 * Shared error taxonomy for the modular monolith. Module interfaces return
 * `Result<T, AppError>` for expected failures; truly exceptional conditions
 * throw. Every error carries a stable `code` for logging and client mapping.
 *
 * Scaffold note: `NotImplementedError` is thrown by every stubbed adapter /
 * runtime path in this scaffold to make "not built yet" explicit and greppable.
 */

export type AppErrorCode =
  | "not_implemented"
  | "unauthenticated"
  | "tenant_isolation"
  | "policy_denied"
  | "entitlement_denied"
  | "approval_required"
  | "validation_failed"
  | "not_found"
  | "rate_limited"
  | "internal";

/** Base application error with a stable code and optional structured detail. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.detail = detail;
  }
}

/** Thrown by stubbed scaffold paths that are intentionally not built yet. */
export class NotImplementedError extends AppError {
  constructor(what: string) {
    super("not_implemented", `Not implemented (scaffold): ${what}`);
  }
}

/** A cross-tenant access attempt or a missing/failed tenant predicate. */
export class TenantIsolationError extends AppError {
  constructor(message = "Tenant isolation violation") {
    super("tenant_isolation", message);
  }
}

/** A gateway/policy check denied the call before execution. */
export class PolicyDeniedError extends AppError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super("policy_denied", message, detail);
  }
}

/** A consequential (write/dangerous) operation requires human approval. */
export class ApprovalRequiredError extends AppError {
  constructor(message = "Human approval required before execution") {
    super("approval_required", message);
  }
}

/** Schema/shape validation of input or model/tool output failed. */
export class ValidationError extends AppError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super("validation_failed", message, detail);
  }
}
