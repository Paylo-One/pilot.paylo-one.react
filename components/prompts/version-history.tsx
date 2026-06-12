"use client";

/**
 * components/prompts/version-history.tsx
 *
 * The append-only version history for one prompt: every version with status,
 * change note, and who/when; per-version actions (view, activate, archive,
 * restore, compare); and the "new version" editor — editing never overwrites,
 * it appends a draft the operator can test and then activate.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StoredPromptVersion, TenantPromptDetail } from "@/modules/prompt-versioning";
import {
  activatePromptVersionAction,
  archivePromptVersionAction,
  createPromptVersionAction,
  restorePromptVersionAction,
} from "@/app/(app)/prompts/actions";
import { VersionCompare } from "./version-compare";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_TONE: Record<StoredPromptVersion["status"], string> = {
  active: "ok",
  draft: "info",
  archived: "neutral",
};

export function VersionHistory({ prompt }: { prompt: TenantPromptDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [temperature, setTemperature] = useState<string>("");
  const [maxTokens, setMaxTokens] = useState<string>("");

  const versions = prompt.versions;
  const latest = versions[0] ?? null;

  const comparePair = useMemo(() => {
    if (compareIds.length !== 2) return null;
    const a = versions.find((v) => v.id === compareIds[0]);
    const b = versions.find((v) => v.id === compareIds[1]);
    if (!a || !b) return null;
    // Older version first so the diff reads old → new.
    return a.versionNumber <= b.versionNumber ? { from: a, to: b } : { from: b, to: a };
  }, [compareIds, versions]);

  function run(action: () => Promise<{ ok: boolean; error: string | null }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setMessage(res.error);
    });
  }

  function openEditor(from?: StoredPromptVersion) {
    const base = from ?? latest;
    setDraftContent(base?.content ?? "");
    setTemperature(base ? String(base.modelSettings.temperature ?? "") : "");
    setMaxTokens(base ? String(base.modelSettings.maxTokens ?? "") : "");
    setChangeNote("");
    setEditorOpen(true);
  }

  function saveDraft() {
    setMessage(null);
    startTransition(async () => {
      const res = await createPromptVersionAction({
        tenantPromptId: prompt.id,
        content: draftContent,
        modelSettings: {
          temperature: temperature === "" ? undefined : Number(temperature),
          maxTokens: maxTokens === "" ? undefined : Number(maxTokens),
        },
        changeNote: changeNote || undefined,
      });
      if (res.ok) {
        setEditorOpen(false);
        router.refresh();
      } else {
        setMessage(res.error);
      }
    });
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length === 2
          ? [prev[1]!, id]
          : [...prev, id],
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card__title">Versions</h2>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => openEditor()}
          disabled={pending}
        >
          New version
        </button>
      </div>

      <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
        Editing never overwrites: changes are saved as a new draft version you
        can test below and then activate. Select two versions to compare them.
      </p>

      {/* --- New version editor ---------------------------------------------- */}
      {editorOpen ? (
        <div
          className="stack"
          style={{
            gap: "var(--space-md)",
            marginBottom: "var(--space-lg)",
            paddingBottom: "var(--space-lg)",
            borderBottom: "1px solid var(--colour-border)",
          }}
        >
          <div className="field">
            <label className="label" htmlFor="draft-content">
              Prompt content (system instruction)
            </label>
            <textarea
              id="draft-content"
              className="textarea mono"
              rows={14}
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
            />
          </div>
          <div className="grid grid--2">
            <div className="field">
              <label className="label" htmlFor="draft-temperature">
                Temperature
              </label>
              <input
                id="draft-temperature"
                className="input"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="draft-max-tokens">
                Max tokens
              </label>
              <input
                id="draft-max-tokens"
                className="input"
                type="number"
                min="1"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="draft-note">
              Change note
            </label>
            <input
              id="draft-note"
              className="input"
              placeholder="What changed, and why?"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={saveDraft}
              disabled={pending || !draftContent.trim()}
            >
              {pending ? "Saving…" : "Save as new draft version"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setEditorOpen(false)}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* --- Version list ------------------------------------------------------ */}
      <ul className="stack" style={{ gap: "var(--space-md)" }}>
        {versions.map((version) => {
          const expanded = expandedId === version.id;
          const selected = compareIds.includes(version.id);
          return (
            <li
              key={version.id}
              style={{
                paddingBottom: "var(--space-md)",
                borderBottom: "1px solid var(--colour-border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "var(--space-md)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                  <span className="badge">v{version.versionNumber}</span>
                  <span className={`status status--${STATUS_TONE[version.status]}`}>
                    {version.status}
                  </span>
                  <span className="mono text-tertiary">
                    {formatTimestamp(version.createdAt)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`filter-chip${selected ? " filter-chip--active" : ""}`}
                    onClick={() => toggleCompare(version.id)}
                  >
                    Compare
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setExpandedId(expanded ? null : version.id)}
                  >
                    {expanded ? "Hide" : "View"}
                  </button>
                  {version.status !== "active" ? (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() =>
                        run(() => activatePromptVersionAction({ versionId: version.id }))
                      }
                      disabled={pending}
                    >
                      Activate
                    </button>
                  ) : null}
                  {version.status !== "archived" ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        run(() => archivePromptVersionAction({ versionId: version.id }))
                      }
                      disabled={pending}
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        run(() => restorePromptVersionAction({ versionId: version.id }))
                      }
                      disabled={pending}
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
              {version.changeNote ? (
                <p className="scaffold-note" style={{ margin: "var(--space-xs) 0 0" }}>
                  {version.changeNote}
                </p>
              ) : null}
              {expanded ? (
                <pre className="prompt-content mono" style={{ marginTop: "var(--space-sm)" }}>
                  {version.content}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* --- Compare ----------------------------------------------------------- */}
      {comparePair ? (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <VersionCompare from={comparePair.from} to={comparePair.to} />
        </div>
      ) : compareIds.length === 1 ? (
        <p className="scaffold-note" style={{ marginTop: "var(--space-md)" }}>
          Select one more version to compare.
        </p>
      ) : null}

      {message ? <p className="form-message form-message--error">{message}</p> : null}
    </section>
  );
}
