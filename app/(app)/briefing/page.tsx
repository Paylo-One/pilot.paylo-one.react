/**
 * Briefing — Screen 1, the Daily Memo (the wedge). product/daily-memo.md.
 *
 * Server Component: reads the latest briefing for the tenant via the USER
 * server client (RLS active). Generation is on-demand through the Generate
 * button -> server action -> agent orchestration -> governed Model Gateway.
 *
 * The memo is editorial, not a dashboard dump: ranked by consequence, calm,
 * with every insight carrying its source references (the trust contract). When
 * no real briefing exists yet, the surface renders an illustrative memo so the
 * full eleven-section structure is visible — clearly labelled as a preview.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  getLatestBriefing,
  type BriefingSectionView,
} from "@/modules/briefing/server";
import { GenerateMemoButton } from "./generate-button";
import {
  SAMPLE_MEMO,
  type SampleSection,
  type SampleReference,
} from "./sample-memo";

function formatTimestamp(value: string | null): string {
  if (!value) return "unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unknown time"
    : date.toLocaleString("en-GB");
}

function titleCase(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* --- Real briefing rendering --------------------------------------------- */

function RealReferences({ section }: { section: BriefingSectionView }) {
  if (section.references.length === 0) return null;
  return (
    <div className="source-ref-row">
      {section.references.map((ref) => (
        <span
          key={ref.id}
          className="source-ref"
          title={ref.excerptOrPointer ?? undefined}
        >
          <span className="source-ref__system">{ref.sourceSystem}</span>
          {typeof ref.confidence === "number" ? (
            <span className="source-ref__confidence">
              {Math.round(ref.confidence * 100)}%
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/* --- Sample memo rendering ----------------------------------------------- */

function SampleReferenceRow({ refs }: { refs: SampleReference[] }) {
  return (
    <div className="source-ref-row">
      {refs.map((ref, i) => (
        <span
          key={`${ref.system}-${i}`}
          className="source-ref"
          title={`${ref.pointer} · ${ref.timestamp}`}
        >
          <span className="source-ref__system">{ref.system}</span>
          <span aria-hidden="true">·</span>
          <span>{ref.timestamp}</span>
          <span className="source-ref__confidence">
            {Math.round(ref.confidence * 100)}%
          </span>
        </span>
      ))}
    </div>
  );
}

function SampleSectionBlock({
  section,
  index,
}: {
  section: SampleSection;
  index: number;
}) {
  return (
    <section
      className={`memo__section${section.focus ? " memo__section--focus" : ""}`}
    >
      <div className="memo__section-head">
        <span className="memo__section-no">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="memo__section-title">{section.title}</span>
      </div>

      {section.layout === "summary" && section.summary ? (
        <p className="memo__summary">{section.summary}</p>
      ) : null}

      {section.layout === "items" && section.items ? (
        <div>
          {section.items.map((item, i) => (
            <div className="memo-item" key={i}>
              <div className="memo-item__main">
                <p className="memo-item__title">{item.title}</p>
                {item.detail ? (
                  <p className="memo-item__detail">{item.detail}</p>
                ) : null}
                <SampleReferenceRow refs={item.references} />
              </div>
              {item.status ? (
                <div className="memo-item__aside">
                  <span className={`status status--${item.status.tone}`}>
                    {item.status.label}
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default async function BriefingPage() {
  const ctx = await requireTenantContext();
  const briefing = await getLatestBriefing(ctx.tenantId);

  return (
    <main className="workspace__content">
      <div className="page-head">
        <div className="page-head__row">
          <div>
            <p className="eyebrow">Daily Memo</p>
            <h1 className="page-head__title">What matters today</h1>
            <p className="page-head__lead">
              Every morning, know what matters, what changed, what needs
              approval, and what cannot slip — ranked by consequence and
              traceable to source.
            </p>
          </div>
          <GenerateMemoButton hasBriefing={Boolean(briefing)} />
        </div>
      </div>

      {briefing ? (
        /* --- Real briefing ------------------------------------------------ */
        <div className="memo">
          <div className="memo__head">
            <div>
              <p className="memo__kicker">
                Paylo.one Management OS · Daily Memo
              </p>
              <h2 className="memo__title">Your briefing</h2>
              <p className="memo__meta">
                Generated {formatTimestamp(briefing.generatedAt)} ·{" "}
                {briefing.status} · {ctx.tenantSlug}.paylo.one
              </p>
            </div>
          </div>

          {briefing.summary ? (
            <section className="memo__section memo__section--focus">
              <div className="memo__section-head">
                <span className="memo__section-no">01</span>
                <span className="memo__section-title">Executive summary</span>
              </div>
              <p className="memo__summary">{briefing.summary}</p>
            </section>
          ) : null}

          {briefing.sections.map((section) => (
            <section className="memo__section" key={section.id}>
              <div className="memo__section-head">
                <span className="memo__section-title">
                  {titleCase(section.kind)}
                </span>
              </div>
              {section.title ? (
                <p className="memo-item__title">{section.title}</p>
              ) : null}
              {section.body ? (
                <p
                  className="memo__summary"
                  style={{ whiteSpace: "pre-wrap", marginTop: "var(--space-sm)" }}
                >
                  {section.body}
                </p>
              ) : null}
              <RealReferences section={section} />
            </section>
          ))}
        </div>
      ) : (
        /* --- Illustrative memo (no real briefing yet) -------------------- */
        <>
          <div className="alert alert--accent" style={{ marginBottom: "var(--space-md)" }}>
            <div>
              <p className="alert__title">Preview — illustrative memo</p>
              <p className="alert__body">
                No memo has been generated for this workspace yet. The structure
                below shows how a Daily Memo reads once your sources are
                connected. Generate one to replace it with your own.
              </p>
            </div>
          </div>

          <div className="memo">
            <div className="memo__head">
              <div>
                <p className="memo__kicker">
                  Paylo.one Management OS · Daily Memo · Sample
                </p>
                <h2 className="memo__title">What matters today</h2>
                <p className="memo__meta">
                  Illustrative · grounded in 5 sources · {ctx.tenantSlug}.paylo.one
                </p>
              </div>
            </div>

            {SAMPLE_MEMO.sections.map((section, index) => (
              <SampleSectionBlock
                key={section.kind}
                section={section}
                index={index}
              />
            ))}
          </div>
        </>
      )}

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        Generation runs through agent orchestration and the governed Model
        Gateway. The system prepares; nothing is sent on your behalf.
      </p>
    </main>
  );
}
