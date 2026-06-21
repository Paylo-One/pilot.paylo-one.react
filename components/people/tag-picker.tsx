"use client";

/**
 * components/people/tag-picker.tsx
 *
 * Apply and explain behavioural tags. A tag is not decoration: catalogued tags
 * carry a contract (people-tags.ts) and, when applied, change what Pilot does —
 * raising a person in the briefing, proposing a follow-up, or keeping them quiet
 * until relevant. The picker shows each tag's effect plainly and confirms what
 * changed, so the operator always knows why the system behaves as it does.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TAG_SURFACE_LABELS,
  getTagDefinition,
  tagsFor,
  type TagDefinition,
} from "@/modules/people/people-tags";
import { addTagAction, removeTagAction } from "@/app/(app)/people/actions";
import { addCompanyTagAction, removeCompanyTagAction } from "@/app/(app)/companies/actions";

export function TagPicker({
  entity,
  entityId,
  tags,
}: {
  entity: "person" | "company";
  entityId: string;
  tags: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogue = useMemo(() => {
    const applied = new Set(tags.map((t) => t.toLowerCase()));
    return tagsFor(entity).filter((t) => !applied.has(t.slug.toLowerCase()));
  }, [entity, tags]);

  function add(tag: string) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res =
        entity === "person"
          ? await addTagAction({ personId: entityId, tag })
          : await addCompanyTagAction({ companyId: entityId, tag });
      if (!res.ok) {
        setError(res.error ?? "Could not add that tag.");
        return;
      }
      const effects = (res as { effects?: string[] }).effects ?? [];
      setNote(effects.length > 0 ? effects.join(" ") : "Tag added.");
      setCustom("");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(tag: string) {
    setError(null);
    startTransition(async () => {
      const res =
        entity === "person"
          ? await removeTagAction({ personId: entityId, tag })
          : await removeCompanyTagAction({ companyId: entityId, tag });
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not remove that tag.");
    });
  }

  return (
    <div className="tag-picker">
      <div className="tag-picker__current">
        {tags.length === 0 ? (
          <span className="tag-picker__none">No tags yet.</span>
        ) : (
          tags.map((tag) => {
            const def = getTagDefinition(tag);
            return (
              <span
                key={tag}
                className={`chip tag-chip${def ? ` tag-chip--${def.tone}` : ""}`}
                title={def ? def.explanation : "Free-text tag (no automatic effect)."}
              >
                {def ? def.label : tag}
                <button
                  type="button"
                  className="tag-chip__remove"
                  aria-label={`Remove ${def ? def.label : tag}`}
                  disabled={pending}
                  onClick={() => remove(tag)}
                >
                  ×
                </button>
              </span>
            );
          })
        )}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={pending}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Add tag"}
        </button>
      </div>

      {note ? <p className="tag-picker__note">{note}</p> : null}
      {error ? <p className="form-message form-message--error">{error}</p> : null}

      {open ? (
        <div className="tag-picker__menu card card--sunken">
          <p className="eyebrow">Meaningful tags</p>
          <p className="tag-picker__lead">
            Each tag changes how Pilot treats this {entity}. Pick one to see its
            effect.
          </p>
          <ul className="tag-menu">
            {catalogue.map((def: TagDefinition) => (
              <li key={def.slug} className="tag-menu__item">
                <button
                  type="button"
                  className="tag-menu__add"
                  disabled={pending}
                  onClick={() => add(def.slug)}
                >
                  <span className={`status-dot status-dot--${def.tone}`} aria-hidden="true" />
                  <span className="tag-menu__label">{def.label}</span>
                </button>
                <p className="tag-menu__desc">{def.explanation}</p>
                <p className="tag-menu__where mono">
                  {def.behaviour.wired ? "Active" : "Planned"} ·{" "}
                  {def.appearsIn.map((s) => TAG_SURFACE_LABELS[s]).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
          <div className="tag-picker__custom">
            <input
              className="input"
              placeholder="Or add your own label"
              value={custom}
              disabled={pending}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  e.preventDefault();
                  add(custom.trim());
                }
              }}
            />
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={pending || !custom.trim()}
              onClick={() => add(custom.trim())}
            >
              Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
