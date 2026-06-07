"use client";

/**
 * Client control for generating the Daily Memo. Calls the `generateDailyMemo`
 * server action inside a transition so the button reflects in-flight state and
 * surfaces any error (e.g. a policy denial or model failure) inline.
 */

import { useState, useTransition } from "react";
import { generateDailyMemo } from "./actions";

export function GenerateMemoButton({ hasBriefing }: { hasBriefing: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    setError(null);
    startTransition(async () => {
      const response = await generateDailyMemo();
      if (!response.ok) {
        setError(response.error ?? "Generation failed. Please try again.");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <button
        type="button"
        onClick={onGenerate}
        disabled={isPending}
        style={{
          alignSelf: "flex-start",
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-small)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--colour-accent)",
          background: isPending ? "var(--colour-surface-sunken)" : "var(--colour-accent)",
          color: isPending ? "var(--colour-text-secondary)" : "var(--colour-accent-on)",
          cursor: isPending ? "default" : "pointer",
          transition: "background var(--speed) var(--ease-standard)",
        }}
      >
        {isPending
          ? "Generating…"
          : hasBriefing
            ? "Regenerate Daily Memo"
            : "Generate Daily Memo"}
      </button>
      {error ? (
        <p style={{ color: "#b4452f", fontSize: "var(--text-small)" }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
