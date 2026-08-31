"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { storeActionDraft } from "@/app/(app)/actions/action-draft";

export function MemoActionDraft({ title, note, contextId, briefingSectionId }: { title: string; note: string; contextId: string; briefingSectionId: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <button
        type="button"
        className="chip"
        onClick={() => {
          try {
            storeActionDraft(window.sessionStorage, {
              title,
              note,
              contextId,
              briefingSectionId,
              handoffKey: window.crypto.randomUUID(),
              createdFrom: "briefing",
            });
            router.push("/actions");
          } catch {
            setFailed(true);
          }
        }}
      >
        Turn into action
      </button>
      {failed ? <span className="form-message form-message--error">Could not carry this context to Actions.</span> : null}
    </>
  );
}
