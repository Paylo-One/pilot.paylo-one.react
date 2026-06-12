"use client";

/**
 * components/prompts/test-panel.tsx
 *
 * Test a prompt version against sample inputs BEFORE activating it. The run
 * goes through the real Model Gateway with the version pinned explicitly
 * (drafts included), is metered as a test, and is persisted as evidence. The
 * result shows input, version, model settings, output, validation, and errors.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StoredTestRun, TenantPromptDetail } from "@/modules/prompt-versioning";
import {
  runPromptTestAction,
  type PromptTestResult,
} from "@/app/(app)/prompts/actions";

export interface TestPanelItem {
  readonly id: string;
  readonly system: string;
  readonly title: string;
  readonly occurredAt: string;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TestPanel({
  prompt,
  recentItems,
  recentRuns,
}: {
  prompt: TenantPromptDetail;
  recentItems: readonly TestPanelItem[];
  recentRuns: readonly StoredTestRun[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const testableVersions = prompt.versions;
  const defaultVersion =
    testableVersions.find((v) => v.status === "draft") ??
    testableVersions.find((v) => v.status === "active") ??
    testableVersions[0] ??
    null;

  const [versionId, setVersionId] = useState<string>(defaultVersion?.id ?? "");
  const [inputKind, setInputKind] = useState<"source_items" | "pasted">(
    recentItems.length > 0 ? "source_items" : "pasted",
  );
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [pastedSample, setPastedSample] = useState("");
  const [result, setResult] = useState<PromptTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedVersion = useMemo(
    () => testableVersions.find((v) => v.id === versionId) ?? null,
    [testableVersions, versionId],
  );

  function toggleItem(id: string) {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-10),
    );
  }

  function runTest() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await runPromptTestAction({
        versionId,
        inputKind,
        sourceItemIds: inputKind === "source_items" ? selectedItems : undefined,
        pastedSample: inputKind === "pasted" ? pastedSample : undefined,
      });
      if (res.ok) {
        setResult(res);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!defaultVersion) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card__title">Test a version</h2>
      </div>
      <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
        Run a version against real signals or a pasted sample before activating
        it. Test runs go through the governed Model Gateway, are metered as
        tests, and are recorded below.
      </p>

      <div className="stack" style={{ gap: "var(--space-md)" }}>
        <div className="grid grid--2">
          <div className="field">
            <label className="label" htmlFor="test-version">
              Version
            </label>
            <select
              id="test-version"
              className="input"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
            >
              {testableVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber} · {v.status}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="test-input-kind">
              Sample input
            </label>
            <select
              id="test-input-kind"
              className="input"
              value={inputKind}
              onChange={(e) => setInputKind(e.target.value as "source_items" | "pasted")}
            >
              <option value="source_items" disabled={recentItems.length === 0}>
                Recent source items{recentItems.length === 0 ? " (none ingested)" : ""}
              </option>
              <option value="pasted">Pasted sample</option>
            </select>
          </div>
        </div>

        {inputKind === "source_items" ? (
          <div className="field">
            <span className="label">
              Choose items ({selectedItems.length} selected, max 10)
            </span>
            <ul
              className="stack"
              style={{
                gap: "var(--space-xs)",
                maxHeight: 220,
                overflowY: "auto",
                border: "1px solid var(--colour-border)",
                borderRadius: "var(--radius-sm)",
                padding: "var(--space-sm)",
              }}
            >
              {recentItems.map((item) => (
                <li key={item.id}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "var(--space-sm)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item.id)}
                      onChange={() => toggleItem(item.id)}
                    />
                    <span className="badge badge--plain">{item.system}</span>
                    <span style={{ flex: 1 }}>{item.title}</span>
                    <span className="mono text-tertiary">
                      {formatTimestamp(item.occurredAt)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="test-pasted">
              Sample input (e.g. an email body or message)
            </label>
            <textarea
              id="test-pasted"
              className="textarea"
              rows={5}
              value={pastedSample}
              onChange={(e) => setPastedSample(e.target.value)}
              placeholder="Paste a representative signal to test against…"
            />
          </div>
        )}

        <div>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={runTest}
            disabled={
              pending ||
              !versionId ||
              (inputKind === "source_items"
                ? selectedItems.length === 0
                : !pastedSample.trim())
            }
          >
            {pending ? "Running…" : "Run test"}
          </button>
        </div>

        {error ? <p className="form-message form-message--error">{error}</p> : null}

        {/* --- Result ---------------------------------------------------------- */}
        {result ? (
          <div
            className="stack"
            style={{
              gap: "var(--space-sm)",
              borderTop: "1px solid var(--colour-border)",
              paddingTop: "var(--space-md)",
            }}
          >
            <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
              <span className={`status status--${result.status === "ok" ? "ok" : "risk"}`}>
                {result.status === "ok" ? "Succeeded" : "Failed"}
              </span>
              {selectedVersion ? (
                <span className="badge">v{selectedVersion.versionNumber}</span>
              ) : null}
              {result.modelId ? (
                <span className="badge badge--plain mono">{result.modelId}</span>
              ) : null}
              {typeof result.latencyMs === "number" ? (
                <span className="mono text-tertiary">{result.latencyMs} ms</span>
              ) : null}
            </div>
            {result.validation ? (
              <p
                className={`form-message ${
                  result.validation.passed ? "form-message--ok" : "form-message--error"
                }`}
              >
                {result.validation.passed
                  ? "Output contains all required keys."
                  : `Output is missing required keys: ${result.validation.missingKeys.join(", ")}.`}
              </p>
            ) : null}
            {result.status === "ok" ? (
              <pre className="prompt-content mono">
                {JSON.stringify(result.output, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}

        {/* --- Recent runs ------------------------------------------------------ */}
        {recentRuns.length > 0 ? (
          <div
            style={{ borderTop: "1px solid var(--colour-border)", paddingTop: "var(--space-md)" }}
          >
            <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
              Recent test runs
            </p>
            <ul className="stack" style={{ gap: "var(--space-xs)" }}>
              {recentRuns.map((run) => {
                const version = prompt.versions.find((v) => v.id === run.promptVersionId);
                return (
                  <li
                    key={run.id}
                    style={{
                      display: "flex",
                      gap: "var(--space-sm)",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
                      <span
                        className={`status status--${run.status === "ok" ? "ok" : "risk"}`}
                      >
                        {run.status}
                      </span>
                      {version ? <span className="badge badge--plain">v{version.versionNumber}</span> : null}
                      <span className="text-secondary">
                        {run.inputKind === "source_items" ? "source items" : "pasted sample"}
                      </span>
                    </span>
                    <span className="mono text-tertiary">{formatTimestamp(run.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
