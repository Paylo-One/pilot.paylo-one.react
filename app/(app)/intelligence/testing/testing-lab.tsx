"use client";

/**
 * Testing Lab: try a prompt version against your real information, compare it
 * with what is live, and read an impartial evaluation of which is better —
 * before anything is published. Reuses the governed Model Gateway, so a test
 * runs exactly as the real thing would.
 */

import { useMemo, useState, useTransition } from "react";
import { runPromptEvaluationAction, type PromptEvaluation } from "./actions";

interface PromptOption {
  id: string;
  name: string;
}
interface VersionOption {
  id: string;
  promptId: string;
  versionNumber: number;
  status: string;
}
interface ItemOption {
  id: string;
  system: string;
  title: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  clarity: "Clarity",
  relevance: "Relevance",
  completeness: "Completeness",
  riskSensitivity: "Risk sensitivity",
  actionUsefulness: "Action usefulness",
  toneAlignment: "Tone alignment",
  sourceGrounding: "Source grounding",
};

const VERDICT_COPY: Record<
  PromptEvaluation["verdict"],
  { label: string; tone: string }
> = {
  better: { label: "Better than live", tone: "ok" },
  similar: { label: "About the same as live", tone: "info" },
  worse: { label: "Worse than live", tone: "warn" },
  no_comparison: { label: "Evaluated", tone: "info" },
};

export function TestingLab({
  prompts,
  versions,
  items,
}: {
  prompts: readonly PromptOption[];
  versions: readonly VersionOption[];
  items: readonly ItemOption[];
}) {
  const [promptId, setPromptId] = useState<string>(prompts[0]?.id ?? "");
  const promptVersions = useMemo(
    () =>
      versions
        .filter((v) => v.promptId === promptId)
        .sort((a, b) => b.versionNumber - a.versionNumber),
    [versions, promptId],
  );
  const [versionId, setVersionId] = useState<string>(
    promptVersions[0]?.id ?? "",
  );
  const [inputKind, setInputKind] = useState<"source_items" | "pasted">(
    items.length > 0 ? "source_items" : "pasted",
  );
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [compare, setCompare] = useState(true);

  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof runPromptEvaluationAction>
  > | null>(null);

  // Keep the version selector valid when the prompt changes.
  function onPromptChange(id: string) {
    setPromptId(id);
    const next = versions
      .filter((v) => v.promptId === id)
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    setVersionId(next?.id ?? "");
    setResult(null);
  }

  function toggleItem(id: string) {
    setSelectedItems((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  }

  function run() {
    setMessage(null);
    setResult(null);
    startTransition(async () => {
      const res = await runPromptEvaluationAction({
        versionId,
        inputKind,
        sourceItemIds:
          inputKind === "source_items" ? [...selectedItems] : undefined,
        pastedSample: inputKind === "pasted" ? pasted : undefined,
        compareToActive: compare,
      });
      if (res.ok) setResult(res);
      else setMessage(res.error);
    });
  }

  const evaluation = result?.evaluation ?? null;

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      <p className="page-head__lead" style={{ marginTop: 0, maxWidth: "65ch" }}>
        Try a change before you commit to it. Pick a prompt and a version, give
        it a real example, and Pilot will run it — then score the result against
        what is live, so you can decide with evidence rather than a hunch.
      </p>

      <section className="card">
        <div className="card-head">
          <h2 className="card__title">Set up the test</h2>
        </div>
        <div className="stack" style={{ gap: "var(--space-md)" }}>
          <div className="grid grid--2">
            <div className="field">
              <label className="label" htmlFor="tl-prompt">
                Prompt
              </label>
              <select
                id="tl-prompt"
                className="input"
                value={promptId}
                onChange={(e) => onPromptChange(e.target.value)}
              >
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="tl-version">
                Version to try
              </label>
              <select
                id="tl-version"
                className="input"
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
              >
                {promptVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber} · {v.status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="filter-bar" role="group" aria-label="Sample type">
            <button
              type="button"
              className={`filter-chip${inputKind === "source_items" ? " filter-chip--active" : ""}`}
              onClick={() => setInputKind("source_items")}
              disabled={items.length === 0}
            >
              From your sources
            </button>
            <button
              type="button"
              className={`filter-chip${inputKind === "pasted" ? " filter-chip--active" : ""}`}
              onClick={() => setInputKind("pasted")}
            >
              Paste an example
            </button>
          </div>

          {inputKind === "source_items" ? (
            items.length === 0 ? (
              <p className="scaffold-note">
                No recent items to test against yet. Paste an example instead.
              </p>
            ) : (
              <div
                className="stack"
                style={{
                  gap: "var(--space-xs)",
                  maxHeight: "240px",
                  overflowY: "auto",
                }}
              >
                {items.map((item) => (
                  <label
                    key={item.id}
                    style={{
                      display: "flex",
                      gap: "var(--space-sm)",
                      alignItems: "flex-start",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                    />
                    <span>
                      <span
                        className="mono text-tertiary"
                        style={{ fontSize: "var(--text-label)" }}
                      >
                        {item.system}
                      </span>{" "}
                      {item.title}
                    </span>
                  </label>
                ))}
              </div>
            )
          ) : (
            <div className="field">
              <label className="label" htmlFor="tl-pasted">
                Example content
              </label>
              <textarea
                id="tl-pasted"
                className="textarea"
                rows={6}
                value={pasted}
                placeholder="Paste an email, a message, a meeting note…"
                onChange={(e) => setPasted(e.target.value)}
              />
            </div>
          )}

          <label
            style={{
              display: "flex",
              gap: "var(--space-sm)",
              alignItems: "center",
            }}
          >
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            <span>Compare against the live version</span>
          </label>

          <div>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={run}
              disabled={
                pending ||
                !versionId ||
                (inputKind === "source_items" && selectedItems.size === 0) ||
                (inputKind === "pasted" && !pasted.trim())
              }
            >
              {pending ? "Running…" : "Run evaluation"}
            </button>
          </div>
          {message ? (
            <p className="form-message form-message--error">{message}</p>
          ) : null}
        </div>
      </section>

      {/* --- Evaluation ------------------------------------------------------- */}
      {evaluation ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">The verdict</h2>
            <span
              className={`status status--${VERDICT_COPY[evaluation.verdict]?.tone ?? "info"}`}
            >
              {VERDICT_COPY[evaluation.verdict]?.label ?? "Evaluated"} ·{" "}
              {evaluation.overall}/5
            </span>
          </div>
          <p className="page-head__lead" style={{ marginTop: 0 }}>
            {evaluation.summary}
          </p>
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {Object.entries(evaluation.scores).map(([key, val]) => (
              <div
                key={key}
                className="meta-row"
                style={{ alignItems: "flex-start" }}
              >
                <span className="meta-row__key">
                  {DIMENSION_LABELS[key] ?? key}
                </span>
                <span
                  className="meta-row__value"
                  style={{ textAlign: "right" }}
                >
                  <strong>{val.score}/5</strong>
                  <span
                    className="scaffold-note"
                    style={{ display: "block", margin: 0 }}
                  >
                    {val.reason}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* --- Outputs ---------------------------------------------------------- */}
      {result?.candidateOutput ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">Outputs</h2>
          </div>
          <div
            className={result.activeOutput ? "grid grid--2" : ""}
            style={{ gap: "var(--space-md)" }}
          >
            <div>
              <p
                className="eyebrow"
                style={{ marginBottom: "var(--space-sm)" }}
              >
                Version you tried
              </p>
              <pre className="prompt-content mono">
                {JSON.stringify(result.candidateOutput, null, 2)}
              </pre>
            </div>
            {result.activeOutput ? (
              <div>
                <p
                  className="eyebrow"
                  style={{ marginBottom: "var(--space-sm)" }}
                >
                  Live version
                  {result.activeVersionNumber
                    ? ` · v${result.activeVersionNumber}`
                    : ""}
                </p>
                <pre className="prompt-content mono">
                  {JSON.stringify(result.activeOutput, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
