"use client";

/**
 * components/prompts/version-compare.tsx
 *
 * Side-by-side comparison of two prompt versions: a unified line diff rendered
 * with added/removed tinting (lib/line-diff.ts — no dependency).
 */

import { useMemo } from "react";
import { diffLines } from "@/lib/line-diff";
import type { StoredPromptVersion } from "@/modules/prompt-versioning";

export function VersionCompare({
  from,
  to,
}: {
  from: StoredPromptVersion;
  to: StoredPromptVersion;
}) {
  const diff = useMemo(() => diffLines(from.content, to.content), [from, to]);
  const changed = diff.some((line) => line.kind !== "same");

  return (
    <div>
      <p className="scaffold-note" style={{ marginBottom: "var(--space-sm)" }}>
        Comparing v{from.versionNumber} → v{to.versionNumber}
        {changed ? "" : " — the content is identical."}
      </p>
      <div className="diff" role="figure" aria-label="Version diff">
        {diff.map((line, index) => (
          <div
            key={index}
            className={`diff-line${
              line.kind === "added"
                ? " diff-line--added"
                : line.kind === "removed"
                  ? " diff-line--removed"
                  : ""
            }`}
          >
            <span className="diff-line__marker" aria-hidden="true">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
            </span>
            {line.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}
