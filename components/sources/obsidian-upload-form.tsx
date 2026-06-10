"use client";

/**
 * components/sources/obsidian-upload-form.tsx
 *
 * Upload-first Obsidian connector (ADR-028). The operator selects Markdown notes
 * from their vault; each is parsed (frontmatter, tags, internal wikilinks) and
 * ingested as an `obsidian` source item. Local-first: nothing is read from disk
 * automatically — only the files the operator explicitly chooses.
 */

import { useActionState, useEffect, useRef } from "react";
import {
  uploadObsidianAction,
  type UploadResult,
} from "@/app/(app)/sources/actions";

const INITIAL: UploadResult | null = null;

export function ObsidianUploadForm() {
  const [state, formAction, pending] = useActionState(uploadObsidianAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-md">
      <p className="scaffold-note">
        Obsidian is local-first. Select the Markdown notes you want to bring in —
        nothing on your machine is read automatically. Frontmatter, tags, and
        internal links are parsed and kept with each note.
      </p>

      <div>
        <label
          htmlFor="obsidian-files"
          className="block text-small text-text-secondary mb-xs"
        >
          Vault notes (.md)
        </label>
        <input
          id="obsidian-files"
          name="files"
          type="file"
          accept=".md,.markdown,.mdx,.txt,text/markdown,text/plain"
          multiple
          className="input"
          disabled={pending}
        />
      </div>

      <div className="flex flex-wrap items-center gap-md">
        <button type="submit" disabled={pending} className="btn btn--primary btn--sm">
          {pending ? "Importing…" : "Import notes"}
        </button>
        {state ? (
          <span
            role="status"
            className={`text-small ${state.ok ? "text-accent" : "text-text-secondary"}`}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
