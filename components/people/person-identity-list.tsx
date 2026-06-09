"use client";

/**
 * components/people/person-identity-list.tsx
 *
 * The per-source identity mappings that let Paylo.one resolve incoming signals
 * to this person. Persisted: add an identity, verify an unverified one, or
 * remove it. Verified mappings are the trust anchor for correlation.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IDENTITY_TYPE_LABELS,
  type IdentityType,
  type Person,
  type SourceMappingSourceType,
} from "@/modules/people/people.types";
import { sourceMappings } from "@/modules/people/people-service";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import {
  addIdentityAction,
  verifyIdentityAction,
  removeIdentityAction,
} from "@/app/(app)/people/actions";

function sourceLabel(sourceType: SourceMappingSourceType): string {
  if (sourceType === "generic") return "Email / phone";
  return SOURCE_SYSTEM_LABELS[sourceType] ?? sourceType;
}

const IDENTITY_TYPES: IdentityType[] = ["email", "phone", "whatsapp", "teams", "github", "notion", "alias"];

/** Map a chosen identity type to its source bucket. */
function sourceForType(type: IdentityType): SourceMappingSourceType {
  switch (type) {
    case "whatsapp": return "whatsapp";
    case "teams": return "teams";
    case "github": return "github";
    case "notion": return "notion";
    default: return "generic";
  }
}

export function PersonIdentityList({ person }: { person: Person }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<IdentityType>("email");
  const [value, setValue] = useState("");
  const mappings = sourceMappings(person);

  function run(action: () => Promise<{ ok: boolean; error: string | null }>) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="stack" style={{ gap: "var(--space-sm)" }}>
      {mappings.length === 0 ? (
        <p className="empty__body">No source identities mapped yet.</p>
      ) : (
        mappings.map((mapping) => (
          <div key={mapping.sourceType} className="meta-row" style={{ alignItems: "flex-start" }}>
            <span className="meta-row__key">{sourceLabel(mapping.sourceType)}</span>
            <span className="person-identity__values">
              {mapping.identities.map((identity) => (
                <span key={identity.id} className="person-identity">
                  <span className="mono">{identity.identityValue}</span>
                  <span className="person-identity__type">{IDENTITY_TYPE_LABELS[identity.identityType]}</span>
                  {identity.verifiedByUser ? (
                    <span className="status status--ok">verified</span>
                  ) : (
                    <button type="button" className="feedback-chip" disabled={pending}
                      onClick={() => run(() => verifyIdentityAction({ identityId: identity.id }))}>
                      Verify {Math.round(identity.confidence * 100)}%
                    </button>
                  )}
                  <button type="button" className="feedback-chip" disabled={pending}
                    onClick={() => run(() => removeIdentityAction({ identityId: identity.id }))}>
                    ✕
                  </button>
                </span>
              ))}
            </span>
          </div>
        ))
      )}

      {adding ? (
        <div className="person-link" style={{ marginTop: "var(--space-xs)" }}>
          <select className="input person-link__select" value={type} disabled={pending}
            onChange={(e) => setType(e.target.value as IdentityType)}>
            {IDENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{IDENTITY_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <input className="input person-link__select" placeholder="value" value={value} disabled={pending}
            onChange={(e) => setValue(e.target.value)} />
          <button type="button" className="btn btn--secondary btn--sm" disabled={pending || !value.trim()}
            onClick={() => run(async () => {
              const res = await addIdentityAction({ personId: person.id, sourceType: sourceForType(type), identityType: type, identityValue: value });
              if (res.ok) { setValue(""); setAdding(false); }
              return res;
            })}>
            Add
          </button>
          <button type="button" className="feedback-chip" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="feedback-chip" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
          + Add identity
        </button>
      )}
    </div>
  );
}
