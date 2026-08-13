import type { BriefingSourceReference } from "@/modules/briefing/server";
import { sourceSystemLabel } from "@/modules/source-connection";
import { formatBriefingReferenceTime } from "@/lib/briefing-reference";

/**
 * Render the complete user-facing evidence for one Daily Memo claim.
 * The excerpt stays collapsed until requested so citations remain calm while
 * source, occurrence time, and confidence remain scannable.
 */
export function MemoSourceReference({
  reference,
  timezone,
}: {
  reference: BriefingSourceReference;
  timezone: string;
}) {
  const timestamp = formatBriefingReferenceTime(reference.itemTimestamp, timezone);
  const label = (
    <>
      <span className="source-ref__system">
        {sourceSystemLabel(reference.sourceSystem)}
      </span>
      {timestamp ? <span>{timestamp}</span> : null}
      {typeof reference.confidence === "number" ? (
        <span className="source-ref__confidence">
          {Math.round(reference.confidence * 100)}%
        </span>
      ) : null}
    </>
  );

  if (!reference.excerptOrPointer) {
    return <span className="source-ref">{label}</span>;
  }

  return (
    <details className="source-ref-detail">
      <summary className="source-ref">{label}</summary>
      <blockquote className="source-ref-detail__excerpt">
        {reference.excerptOrPointer}
      </blockquote>
    </details>
  );
}
