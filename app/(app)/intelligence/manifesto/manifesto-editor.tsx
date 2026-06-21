"use client";

/**
 * The Manager Manifesto editor: a readable, document-like surface for the
 * guiding principles that shape every judgement Pilot makes. Owners and admins
 * can edit (which appends a draft) and publish; everyone reads. Version history
 * with publish and restore sits below.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ManagerManifestoDetail,
  ManifestoVersion,
} from "@/modules/manager-manifesto";
import {
  activateManifestoVersionAction,
  createManifestoVersionAction,
  restoreManifestoVersionAction,
} from "./actions";

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

const STATUS_TONE: Record<ManifestoVersion["status"], string> = {
  active: "ok",
  draft: "info",
  archived: "neutral",
};

export function ManifestoEditor({
  manifesto,
  canEdit,
}: {
  manifesto: ManagerManifestoDetail;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const active = useMemo(
    () => manifesto.versions.find((v) => v.status === "active") ?? null,
    [manifesto.versions],
  );
  const latest = manifesto.versions[0] ?? null;

  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(active?.body ?? latest?.body ?? "");
  const [changeNote, setChangeNote] = useState("");

  function run(action: () => Promise<{ ok: boolean; error: string | null }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setMessage(res.error);
    });
  }

  function startEdit() {
    setBody(active?.body ?? latest?.body ?? "");
    setChangeNote("");
    setEditing(true);
  }

  function saveDraft() {
    setMessage(null);
    startTransition(async () => {
      const res = await createManifestoVersionAction({
        manifestoId: manifesto.id,
        body,
        changeNote: changeNote || undefined,
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setMessage(res.error);
      }
    });
  }

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      <p className="page-head__lead" style={{ marginTop: 0, maxWidth: "65ch" }}>
        Your manifesto is the standing instruction behind every judgement Pilot
        makes. It guides what gets surfaced, how things are summarised, when a
        risk is flagged, and what becomes an action. Write it as you would brief
        a sharp new chief of staff. It shapes everything else in this section.
      </p>

      <section className="card">
        <div className="card-head">
          <h2 className="card__title">Manifesto</h2>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
            }}
          >
            {active ? (
              <span className="status status--ok">
                Active · v{active.versionNumber}
              </span>
            ) : null}
            {canEdit && !editing ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={startEdit}
                disabled={pending}
              >
                Edit
              </button>
            ) : null}
          </div>
        </div>

        {editing ? (
          <div className="stack" style={{ gap: "var(--space-md)" }}>
            <p className="scaffold-note">
              Editing saves a new draft. It will not change how Pilot behaves
              until you publish it — and the current version stays live until
              you do.
            </p>
            <div className="field">
              <label className="label" htmlFor="manifesto-body">
                Manifesto
              </label>
              <textarea
                id="manifesto-body"
                className="textarea"
                rows={20}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="manifesto-note">
                What changed, and why?
              </label>
              <input
                id="manifesto-note"
                className="input"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={saveDraft}
                disabled={pending || !body.trim()}
              >
                {pending ? "Saving…" : "Save as draft"}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : active ? (
          <div
            className="prose-manifesto"
            style={{
              whiteSpace: "pre-wrap",
              lineHeight: 1.7,
              maxWidth: "65ch",
            }}
          >
            {active.body}
          </div>
        ) : (
          <p className="scaffold-note">No manifesto is live yet.</p>
        )}
        {message ? (
          <p className="form-message form-message--error">{message}</p>
        ) : null}
      </section>

      {/* --- Version history -------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card__title">Versions</h2>
        </div>
        <ul className="stack" style={{ gap: "var(--space-md)" }}>
          {manifesto.versions.map((version) => (
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-sm)",
                  }}
                >
                  <span className="badge badge--plain">
                    v{version.versionNumber}
                  </span>
                  <span
                    className={`status status--${STATUS_TONE[version.status]}`}
                  >
                    {version.status}
                  </span>
                  <span className="mono text-tertiary">
                    {formatTimestamp(version.createdAt)}
                  </span>
                </div>
                {canEdit ? (
                  <div
                    style={{
                      display: "flex",
                      gap: "var(--space-xs)",
                      flexWrap: "wrap",
                    }}
                  >
                    {version.status !== "active" ? (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() =>
                          run(() =>
                            activateManifestoVersionAction({
                              versionId: version.id,
                            }),
                          )
                        }
                        disabled={pending}
                      >
                        Publish
                      </button>
                    ) : null}
                    {version.status === "archived" ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          run(() =>
                            restoreManifestoVersionAction({
                              versionId: version.id,
                            }),
                          )
                        }
                        disabled={pending}
                      >
                        Restore
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {version.changeNote ? (
                <p
                  className="scaffold-note"
                  style={{ margin: "var(--space-xs) 0 0" }}
                >
                  {version.changeNote}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
