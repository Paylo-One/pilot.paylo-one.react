"use client";

/**
 * components/people/person-signal-list.tsx
 *
 * Recent source items correlated to a person — the relationship-aware view of
 * "what this person has touched lately", with a per-link confidence and a
 * one-tap "wrong person" refinement affordance. Scaffold display only.
 */

import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import type { PersonSignal } from "@/modules/people/people.types";
import { FeedbackChip } from "@/components/refinement/feedback-chip";

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function PersonSignalList({ signals }: { signals: readonly PersonSignal[] }) {
  if (signals.length === 0) {
    return <p className="empty__body">No correlated signals yet.</p>;
  }
  return (
    <ul className="stack" style={{ gap: "var(--space-sm)" }}>
      {signals.map((signal) => (
        <li key={signal.id} className="signal-row">
          <div className="signal-row__main">
            <p className="memo-item__title">{signal.title}</p>
            <p className="repo-row__meta mono">
              {SOURCE_SYSTEM_LABELS[signal.system] ?? signal.system} ·{" "}
              {formatTime(signal.occurredAt)} · {Math.round(signal.confidence * 100)}% match
            </p>
          </div>
          <FeedbackChip feedback="wrong_person" targetType="source_item" targetId={signal.id} />
        </li>
      ))}
    </ul>
  );
}
