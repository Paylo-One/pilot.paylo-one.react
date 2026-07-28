import { describe, expect, it } from "vitest";
import { missingUrlHashes } from "./ingest";

describe("missingUrlHashes", () => {
  it("returns hashes not present in the inserted set", () => {
    // The ignoreDuplicates upsert only returns newly-inserted rows. Any deduped
    // item that collided with a pre-existing news_item (outside the in-memory
    // window) is absent from the inserted set and must be resolved separately,
    // otherwise it is silently skipped for classification and candidacy.
    const deduped = ["a", "b", "c"];
    const inserted = new Set(["a"]);
    expect(missingUrlHashes(deduped, inserted)).toEqual(["b", "c"]);
  });

  it("returns an empty list when every deduped item was inserted", () => {
    const deduped = ["a", "b"];
    const inserted = new Set(["a", "b"]);
    expect(missingUrlHashes(deduped, inserted)).toEqual([]);
  });

  it("de-duplicates repeated hashes so a follow-up lookup queries each once", () => {
    const deduped = ["x", "x", "y", "y"];
    const inserted = new Set<string>();
    expect(missingUrlHashes(deduped, inserted)).toEqual(["x", "y"]);
  });

  it("treats an empty inserted set as everything missing", () => {
    const deduped = ["a", "b", "c"];
    expect(missingUrlHashes(deduped, new Set())).toEqual(["a", "b", "c"]);
  });
});
