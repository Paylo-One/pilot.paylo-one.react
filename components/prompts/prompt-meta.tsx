"use client";

/**
 * components/prompts/prompt-meta.tsx
 *
 * Prompt metadata card: name/description inline edit + archive toggle. Content
 * never changes here — that is version territory (append-only, next card).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TenantPromptDetail } from "@/modules/prompt-versioning";
import {
  setPromptArchivedAction,
  updatePromptMetaAction,
} from "@/app/(app)/prompts/actions";

export function PromptMeta({ prompt }: { prompt: TenantPromptDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(prompt.name);
  const [description, setDescription] = useState(prompt.description ?? "");
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await updatePromptMetaAction({
        promptId: prompt.id,
        name,
        description,
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setMessage(res.error);
      }
    });
  }

  function toggleArchived() {
    setMessage(null);
    startTransition(async () => {
      const res = await setPromptArchivedAction({
        promptId: prompt.id,
        archived: !prompt.archivedAt,
      });
      if (res.ok) router.refresh();
      else setMessage(res.error);
    });
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card__title">Details</h2>
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={toggleArchived}
            disabled={pending}
          >
            {prompt.archivedAt ? "Unarchive" : "Archive prompt"}
          </button>
          {editing ? null : (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setEditing(true)}
            >
              Edit details
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="stack" style={{ gap: "var(--space-md)" }}>
          <div className="field">
            <label className="label" htmlFor="prompt-name">
              Name
            </label>
            <input
              id="prompt-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="prompt-description">
              Description
            </label>
            <textarea
              id="prompt-description"
              className="textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={save}
              disabled={pending || !name.trim()}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setEditing(false);
                setName(prompt.name);
                setDescription(prompt.description ?? "");
              }}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="meta-row">
            <span className="meta-row__key">Workflow</span>
            <span className="meta-row__value">{prompt.workflow}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Created</span>
            <span className="meta-row__value mono">
              {new Date(prompt.createdAt).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Last updated</span>
            <span className="meta-row__value mono">
              {new Date(prompt.updatedAt).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      )}

      {message ? <p className="form-message form-message--error">{message}</p> : null}
    </section>
  );
}
