/**
 * modules/shared — cross-cutting types and helpers for the modular monolith.
 *
 * Every module may import from `@/modules/shared`. Modules must NOT import each
 * other's internals directly; cross-module calls go through a module's exported
 * service interface (technical-design.md "Module boundary rule").
 */

export * from "./tenant-context";
export * from "./result";
export * from "./errors";
export * from "./domain";
