/**
 * Briefing — Screen 1, the Daily Memo (the wedge). product/daily-memo.md.
 *
 * Server Component: reads the latest briefing for the tenant via the USER
 * server client (RLS active). Generation is on-demand through the Generate
 * button -> server action -> agent orchestration -> governed Model Gateway.
 * Every section carries its source references (the trust contract).
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { getLatestBriefing, type BriefingSectionView } from "@/modules/briefing/server";
import { GenerateMemoButton } from "./generate-button";

function formatTimestamp(value: string | null): string {
  if (!value) return "unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown time" : date.toLocaleString("en-GB");
}

function SectionReferences({ section }: { section: BriefingSectionView }) {
  if (section.references.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginTop: "var(--space-sm)" }}>
      {section.references.map((ref) => (
        <span
          key={ref.id}
          className="badge"
          title={ref.excerptOrPointer ?? undefined}
          style={{ textTransform: "none" }}
        >
          {ref.sourceSystem}
          {typeof ref.confidence === "number"
            ? ` · ${Math.round(ref.confidence * 100)}%`
            : ""}
        </span>
      ))}
    </div>
  );
}

export default async function BriefingPage() {
  const ctx = await requireTenantContext();
  const briefing = await getLatestBriefing(ctx.tenantId);

  return (
    <main className="app-main">
      <p className="eyebrow">Briefing</p>
      <h1 style={{ fontSize: "var(--text-h2)", margin: "8px 0 16px" }}>Daily Memo</h1>

      <div
        className="panel"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
      >
        {briefing ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--space-md)",
                flexWrap: "wrap",
              }}
            >
              <span className="eyebrow">
                Generated {formatTimestamp(briefing.generatedAt)} · {briefing.status}
              </span>
              <GenerateMemoButton hasBriefing />
            </div>
            {briefing.summary ? (
              <p style={{ color: "var(--colour-text-primary)" }}>{briefing.summary}</p>
            ) : null}
          </>
        ) : (
          <>
            <p style={{ color: "var(--colour-text-secondary)" }}>
              A calm, one-page brief assembled from your connected channels, ranked by
              consequence, with every claim traceable to its source. No memo has been
              generated yet.
            </p>
            <GenerateMemoButton hasBriefing={false} />
          </>
        )}
      </div>

      {briefing && briefing.sections.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
            marginTop: "var(--space-md)",
          }}
        >
          {briefing.sections.map((section) => (
            <section key={section.id} className="panel">
              <p className="eyebrow">{section.kind}</p>
              <h2 style={{ fontSize: "var(--text-body)", margin: "4px 0 8px" }}>
                {section.title}
              </h2>
              {section.body ? (
                <p
                  style={{
                    color: "var(--colour-text-secondary)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {section.body}
                </p>
              ) : null}
              <SectionReferences section={section} />
            </section>
          ))}
        </div>
      ) : null}

      <p className="scaffold-note" style={{ marginTop: "16px" }}>
        Generation runs through agent orchestration and the governed Model Gateway.
        Nothing is sent on your behalf.
      </p>
    </main>
  );
}
