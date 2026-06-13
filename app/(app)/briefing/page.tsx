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

import Link from "next/link";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  getLatestBriefing,
  getPeopleInFocus,
  type BriefingSectionView,
  type PersonInFocus,
} from "@/modules/briefing/server";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import { IMPORTANCE_LABELS, IMPORTANCE_TONE } from "@/modules/people/people.types";
import { GenerateMemoButton } from "./generate-button";
import { RefinementActions } from "@/components/refinement/refinement-actions";
import { FeedbackChip } from "@/components/refinement/feedback-chip";
import { NewsFeedbackBar } from "@/components/news/news-feedback-bar";
import {
  NEWS_CATEGORY_LABELS,
  type ExternalSignalView,
} from "@/modules/news";
import {
  SAMPLE_MEMO,
  type SampleSection,
  type SampleReference,
  type SamplePerson,
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
  const people = [
    ...new Map(
      section.references
        .filter((r) => r.personId && r.personName)
        .map((r) => [r.personId, r.personName as string]),
    ).entries(),
  ];
  return (
    <>
      {people.length > 0 ? (
        <div className="source-ref-row" aria-label="Linked people">
          {people.map(([personId, name]) => (
            <span key={personId} className="chip chip--accent">
              {people.length > 1 ? "Related: " : "Linked: "}
              {name}
            </span>
          ))}
        </div>
      ) : null}
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
    </>
  );
}

/**
 * Real, correlation-derived section: the people behind recent activity, ranked
 * by importance. Built from People Context + Information Correlation (not an LLM
 * memo) — so the memo is relationship-aware even before an agent briefing exists.
 */
function PeopleInFocusSection({ people }: { people: PersonInFocus[] }) {
  if (people.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: "var(--space-lg)" }}>
      <div className="card-head">
        <div>
          <p className="eyebrow">People in focus</p>
          <h2 className="card__title">Who is behind today&apos;s activity</h2>
        </div>
        <Link href="/people" className="btn btn--ghost btn--sm">
          Open People
        </Link>
      </div>
      <p className="action-card__rationale" style={{ marginTop: 0, marginBottom: "var(--space-md)" }}>
        Correlated from your connected sources by each person&apos;s verified
        identities, ranked by the importance you set.
      </p>
      <div className="stack" style={{ gap: "var(--space-md)" }}>
        {people.map((p) => (
          <div className="memo-item" key={p.personId}>
            <div className="memo-item__main">
              <p className="memo-item__title">
                <Link href="/people" className="source-ref__system">{p.name}</Link>
                {p.roleTitle ? <span className="memo-item__detail"> · {p.roleTitle}</span> : null}
                {p.organisation ? <span className="memo-item__detail"> · {p.organisation}</span> : null}
              </p>
              <p className="memo-item__detail">
                {p.signalCount} recent signal{p.signalCount === 1 ? "" : "s"}
              </p>
              <div className="source-ref-row">
                {p.signals.map((s) => (
                  <span key={s.id} className="source-ref" title={s.title}>
                    <span className="source-ref__system">
                      {SOURCE_SYSTEM_LABELS[s.system] ?? s.system}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{s.title.length > 40 ? `${s.title.slice(0, 39)}…` : s.title}</span>
                    <span className="source-ref__confidence">{Math.round(s.confidence * 100)}%</span>
                  </span>
                ))}
              </div>
              <div className="refinement-actions">
                <span className="refinement-actions__label mono">Refine</span>
                <FeedbackChip feedback="raise_priority" targetType="person" targetId={p.personId} label="Always high priority" />
                <FeedbackChip feedback="lower_priority" targetType="person" targetId={p.personId} />
                <FeedbackChip feedback="do_not_show_again" targetType="person" targetId={p.personId} label="Mute" />
              </div>
            </div>
            <div className="memo-item__aside">
              <span className={`status status--${IMPORTANCE_TONE[p.importance]}`}>
                {IMPORTANCE_LABELS[p.importance]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExternalSignalsSection({
  signals,
}: {
  signals: readonly ExternalSignalView[];
}) {
  if (signals.length === 0) return null;
  return (
    <section className="memo__section">
      <div className="memo__section-head">
        <span className="memo__section-title">External Signals</span>
      </div>
      {signals.map((signal) => (
        <article className="memo-item" key={signal.briefingItemId}>
          <div className="memo-item__main">
            <p className="memo-item__title">
              <a
                href={signal.canonicalUrl}
                target="_blank"
                rel="noreferrer"
                className="source-ref__system"
              >
                {signal.headline}
              </a>
            </p>
            {signal.summary ? (
              <p className="memo-item__detail">{signal.summary}</p>
            ) : null}
            <p className="memo-item__detail">
              <strong>Why it matters:</strong> {signal.whyItMatters}
            </p>
            <div className="source-ref-row">
              <span className="source-ref">
                <span className="source-ref__system">{signal.sourceName}</span>
                {signal.publishedAt ? (
                  <span>{formatTimestamp(signal.publishedAt)}</span>
                ) : null}
              </span>
              {signal.category ? (
                <span className="chip">
                  {NEWS_CATEGORY_LABELS[signal.category]}
                </span>
              ) : null}
            </div>
            <NewsFeedbackBar
              newsItemId={signal.newsItemId}
              sourceName={signal.sourceName}
              topic={signal.category ?? undefined}
            />
          </div>
        </article>
      ))}
    </section>
  );
}

/* --- Sample memo rendering ----------------------------------------------- */

function PeopleRow({ people }: { people: SamplePerson[] }) {
  if (people.length === 0) return null;
  return (
    <div className="source-ref-row" aria-label="Linked people">
      {people.map((person) => (
        <span key={person.id} className="chip chip--accent">
          {people.length > 1 ? "Related: " : "Linked: "}
          {person.name}
        </span>
      ))}
    </div>
  );
}

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
                {item.people && item.people.length > 0 ? (
                  <PeopleRow people={item.people} />
                ) : null}
                <SampleReferenceRow refs={item.references} />
                <RefinementActions
                  targetType="memo_section"
                  targetId={`${section.kind}-${i}`}
                />
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
  const [briefing, peopleInFocus] = await Promise.all([
    getLatestBriefing(ctx),
    getPeopleInFocus(),
  ]);

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

      <PeopleInFocusSection people={peopleInFocus} />

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
          <ExternalSignalsSection signals={briefing.externalSignals} />
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
        Your memo is assembled privately from the sources you have connected.
        Nothing is sent or shared on your behalf.
      </p>
    </main>
  );
}
