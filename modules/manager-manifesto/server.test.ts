import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSecretClient } = vi.hoisted(() => ({
  createSecretClient: vi.fn(),
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: createSecretClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));

import { getActiveManifestoBody, seedTenantManifesto } from "./server";

function failingRead(message: string) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: null,
      error: { message },
    })),
  };
  return query;
}

describe("manager manifesto storage integrity", () => {
  beforeEach(() => {
    createSecretClient.mockReset();
    vi.restoreAllMocks();
  });

  it("does not attempt to seed when the active-version read fails", async () => {
    const query = failingRead("manifesto read unavailable");
    const from = vi.fn(() => query);
    createSecretClient.mockReturnValue({ from });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(getActiveManifestoBody("tenant-1")).resolves.toBeNull();

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("manifesto_versions");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("active body resolution failed"),
      "manifesto read unavailable",
    );
  });

  it("fails before inserting when the seed existence check is unavailable", async () => {
    const query = failingRead("manifesto existence read unavailable");
    const from = vi.fn(() => query);
    createSecretClient.mockReturnValue({ from });

    await expect(seedTenantManifesto("tenant-1")).rejects.toThrow(
      "manifesto existence read unavailable",
    );

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("manager_manifesto");
  });
});
