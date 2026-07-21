/**
 * host.test.ts — exhaustive coverage of the pure host parser shared by
 * subdomain selection and routing (resolveHost + isSelectableSubdomain).
 */

import { describe, expect, it } from "vitest";
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_PATTERN,
  isSelectableSubdomain,
  resolveHost,
} from "./host";

const APEX = "paylo.one";

describe("resolveHost", () => {
  it("returns invalid for a null host", () => {
    expect(resolveHost(null, APEX)).toEqual({ kind: "invalid" });
  });

  it("returns invalid for an empty or whitespace-only host", () => {
    expect(resolveHost("", APEX)).toEqual({ kind: "invalid" });
    expect(resolveHost("   ", APEX)).toEqual({ kind: "invalid" });
  });

  it("returns invalid for a port-only host (':3000')", () => {
    expect(resolveHost(":3000", APEX)).toEqual({ kind: "invalid" });
  });

  it("resolves the apex itself as apex", () => {
    expect(resolveHost("paylo.one", APEX)).toEqual({ kind: "apex" });
  });

  it("resolves www.<apex> as apex", () => {
    expect(resolveHost("www.paylo.one", APEX)).toEqual({ kind: "apex" });
  });

  it("strips the port before resolving", () => {
    expect(resolveHost("paylo.one:3000", APEX)).toEqual({ kind: "apex" });
    expect(resolveHost("bernard.paylo.one:443", APEX)).toEqual({
      kind: "tenant",
      slug: "bernard",
    });
    expect(resolveHost("www.lvh.me:3000", "lvh.me")).toEqual({ kind: "apex" });
  });

  it("lowercases the hostname (host header case-insensitivity)", () => {
    expect(resolveHost("PAYLO.ONE", APEX)).toEqual({ kind: "apex" });
    expect(resolveHost("BERNARD.Paylo.One", APEX)).toEqual({
      kind: "tenant",
      slug: "bernard",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(resolveHost(" bernard.paylo.one ", APEX)).toEqual({
      kind: "tenant",
      slug: "bernard",
    });
  });

  it("resolves a valid tenant subdomain", () => {
    expect(resolveHost("acme.paylo.one", APEX)).toEqual({
      kind: "tenant",
      slug: "acme",
    });
    expect(resolveHost("a-1.paylo.one", APEX)).toEqual({
      kind: "tenant",
      slug: "a-1",
    });
  });

  it("works with an alternate (dev) apex", () => {
    expect(resolveHost("bernard.lvh.me:3000", "lvh.me")).toEqual({
      kind: "tenant",
      slug: "bernard",
    });
    expect(resolveHost("lvh.me", "lvh.me")).toEqual({ kind: "apex" });
  });

  it("returns reserved for every reserved subdomain", () => {
    for (const label of RESERVED_SUBDOMAINS) {
      if (label === "www") continue; // www.<apex> is treated as apex first
      expect(resolveHost(`${label}.${APEX}`, APEX)).toEqual({
        kind: "reserved",
        label,
      });
    }
  });

  it("treats www.<apex> as apex rather than reserved", () => {
    expect(resolveHost(`www.${APEX}`, APEX)).toEqual({ kind: "apex" });
  });

  it("returns invalid for hosts not under the apex", () => {
    expect(resolveHost("example.com", APEX)).toEqual({ kind: "invalid" });
    expect(resolveHost("bernard.other.one", APEX)).toEqual({ kind: "invalid" });
    // Suffix must include the leading dot: evilpaylo.one is not *.paylo.one.
    expect(resolveHost("evilpaylo.one", APEX)).toEqual({ kind: "invalid" });
    // Apex embedded in a longer host must not match.
    expect(resolveHost("paylo.one.evil.com", APEX)).toEqual({ kind: "invalid" });
  });

  it("returns invalid for hosts more than one label deep", () => {
    expect(resolveHost("a.b.paylo.one", APEX)).toEqual({ kind: "invalid" });
    expect(resolveHost("x.www.paylo.one", APEX)).toEqual({ kind: "invalid" });
  });

  it("returns invalid for a bare '.<apex>' (empty label)", () => {
    expect(resolveHost(".paylo.one", APEX)).toEqual({ kind: "invalid" });
  });

  it("returns invalid for syntactically bad labels", () => {
    expect(resolveHost("-abc.paylo.one", APEX)).toEqual({ kind: "invalid" });
    expect(resolveHost("abc-.paylo.one", APEX)).toEqual({ kind: "invalid" });
    expect(resolveHost("ab_c.paylo.one", APEX)).toEqual({ kind: "invalid" });
    // Pattern requires at least 3 characters.
    expect(resolveHost("ab.paylo.one", APEX)).toEqual({ kind: "invalid" });
    expect(resolveHost("a.paylo.one", APEX)).toEqual({ kind: "invalid" });
  });

  it("enforces the 32-character upper bound on labels", () => {
    const max = "a".repeat(32);
    const tooLong = "a".repeat(33);
    expect(resolveHost(`${max}.${APEX}`, APEX)).toEqual({
      kind: "tenant",
      slug: max,
    });
    expect(resolveHost(`${tooLong}.${APEX}`, APEX)).toEqual({ kind: "invalid" });
  });
});

describe("isSelectableSubdomain", () => {
  it("accepts valid DNS-safe labels", () => {
    expect(isSelectableSubdomain("acme")).toBe(true);
    expect(isSelectableSubdomain("abc")).toBe(true); // minimum length 3
    expect(isSelectableSubdomain("a-1")).toBe(true);
    expect(isSelectableSubdomain("tenant-42")).toBe(true);
    expect(isSelectableSubdomain("0abc9")).toBe(true);
    expect(isSelectableSubdomain("a".repeat(32))).toBe(true); // max length 32
  });

  it("rejects labels below the minimum length of 3", () => {
    expect(isSelectableSubdomain("")).toBe(false);
    expect(isSelectableSubdomain("a")).toBe(false);
    expect(isSelectableSubdomain("ab")).toBe(false);
  });

  it("rejects labels above the maximum length of 32", () => {
    expect(isSelectableSubdomain("a".repeat(33))).toBe(false);
  });

  it("rejects hyphens at the edges and illegal characters", () => {
    expect(isSelectableSubdomain("-abc")).toBe(false);
    expect(isSelectableSubdomain("abc-")).toBe(false);
    expect(isSelectableSubdomain("ab_c")).toBe(false);
    expect(isSelectableSubdomain("ab.c")).toBe(false);
    expect(isSelectableSubdomain("ab c")).toBe(false);
    expect(isSelectableSubdomain("abç")).toBe(false);
  });

  it("rejects uppercase (callers must lowercase first)", () => {
    expect(isSelectableSubdomain("ACME")).toBe(false);
    expect(isSelectableSubdomain("Acme")).toBe(false);
  });

  it("rejects every reserved subdomain", () => {
    for (const label of RESERVED_SUBDOMAINS) {
      expect(isSelectableSubdomain(label)).toBe(false);
    }
  });

  it("stays consistent with SUBDOMAIN_PATTERN for accepted labels", () => {
    for (const label of ["acme", "abc", "a-1", "a".repeat(32)]) {
      expect(SUBDOMAIN_PATTERN.test(label)).toBe(true);
    }
  });
});
