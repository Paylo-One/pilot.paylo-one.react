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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", alignItems: "flex-end" }}>
      <button
        type="button"
        onClick={onGenerate}
        disabled={isPending}
        className="btn btn--primary"
      >
        {isPending
          ? "Generating…"
          : hasBriefing
            ? "Regenerate memo"
            : "Generate Daily Memo"}
      </button>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
