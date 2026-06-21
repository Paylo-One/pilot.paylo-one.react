/**
 * components/people/explainability-panel.tsx
 *
 * "Why this person is here" — a calm, plain-language summary of the reasons a
 * person matters and surfaces: how you ranked them, the tags driving behaviour,
 * recent activity, and their strongest connections. Nothing here is a black box;
 * every line traces to something the operator set or Pilot observed.
 */

import { getTagDefinition } from "@/modules/people/people-tags";
import {
  IMPORTANCE_LABELS,
  type Person,
  type ResolvedRelationship,
} from "@/modules/people/people.types";

function buildReasons(person: Person, relationships: readonly ResolvedRelationship[]): string[] {
  const reasons: string[] = [];

  if (person.importance === "critical" || person.importance === "high") {
    reasons.push(
      `You marked them ${IMPORTANCE_LABELS[person.importance]} importance, so their activity surfaces first in your briefing.`,
    );
  }

  for (const tag of person.tags) {
    const def = getTagDefinition(tag);
    if (def && def.behaviour.wired && def.behaviour.kind !== "raise_importance") {
      reasons.push(`Tagged ${def.label}: ${def.explanation}`);
    }
  }

  if (person.companyName) {
    reasons.push(`Works at ${person.companyName}.`);
  }

  if (person.signals.length > 0) {
    const systems = [...new Set(person.signals.map((s) => s.system))];
    reasons.push(
      `${person.signals.length} recent signal${person.signals.length === 1 ? "" : "s"} attributed to them across ${systems.join(", ")}.`,
    );
  }

  const topRel = relationships[0];
  if (topRel) {
    reasons.push(`${topRel.relationshipLabel} ${topRel.otherLabel}.`);
  }

  if (person.linkedActions.length > 0) {
    reasons.push(
      `${person.linkedActions.length} open action${person.linkedActions.length === 1 ? "" : "s"} involve them.`,
    );
  }

  return reasons;
}

export function ExplainabilityPanel({
  person,
  relationships,
}: {
  person: Person;
  relationships: readonly ResolvedRelationship[];
}) {
  const reasons = buildReasons(person, relationships);
  if (reasons.length === 0) {
    return (
      <div className="explain-panel card card--sunken">
        <p className="eyebrow">Why this person is here</p>
        <p className="explain-panel__empty">
          Nothing is raising this person yet. Set their importance, add a tag, or
          link them to your work and the reasons will appear here.
        </p>
      </div>
    );
  }
  return (
    <div className="explain-panel card card--sunken">
      <p className="eyebrow">Why this person is here</p>
      <ul className="explain-panel__list">
        {reasons.map((r) => (
          <li key={r} className="explain-panel__item">
            <span className="explain-panel__bullet" aria-hidden="true" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
