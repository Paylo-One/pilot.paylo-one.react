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
import { listSuggestedActions } from "@/modules/action-extraction/server";
import { diaryService, type DiaryEntry } from "@/modules/diary";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import { IMPORTANCE_LABELS, IMPORTANCE_TONE } from "@/modules/people/people.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

function ActionsAttentionSection({ actions }: { actions: any[] }) {
  const now = new Date();
  
  const isPast = (dateStr: string) => {
    const d = new Date(dateStr);
    return d < now && d.toDateString() !== now.toDateString();
  };
  
  const isTodayDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toDateString() === now.toDateString();
  };

  const overdue = actions.filter(
    (a) =>
      (a.status === "planned" || a.status === "in_progress") &&
      a.dueAt &&
      isPast(a.dueAt)
  );

  const dueToday = actions.filter(
    (a) =>
      a.status !== "completed" &&
      a.status !== "cancelled" &&
      a.dueAt &&
      isTodayDate(a.dueAt)
  );

  const followUpToday = actions.filter(
    (a) =>
      a.status !== "completed" &&
      a.status !== "cancelled" &&
      (a.status === "follow_up" || (a.followUpAt && (isPast(a.followUpAt) || isTodayDate(a.followUpAt))))
  );

  const waitingOn = actions.filter((a) => a.status === "waiting");

  const totalAttentionCount = overdue.length + dueToday.length + followUpToday.length + waitingOn.length;

  if (totalAttentionCount === 0) return null;

  return (
    <div className="card" style={{ marginBottom: "var(--space-lg)" }}>
      <div className="card-head">
        <div>
          <p className="eyebrow">Commitments & Attention</p>
          <h2 className="card__title">Actions requiring your attention today</h2>
        </div>
        <Link href="/actions" className="btn btn--ghost btn--sm">
          Open Actions
        </Link>
      </div>
      <p className="action-card__rationale" style={{ marginTop: 0, marginBottom: "var(--space-md)" }}>
        Real-time commitments requiring follow-through, escalations, or attention, synchronized directly with your execution memory.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--space-md)" }}>
        {/* Overdue column */}
        {overdue.length > 0 && (
          <div style={{ border: "1px solid var(--colour-danger)", borderRadius: "var(--radius-sm)", padding: "var(--space-md)", background: "rgba(224, 32, 32, 0.04)" }}>
            <h3 style={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--colour-danger)", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: "var(--space-sm)" }}>
              ⚠️ Overdue ({overdue.length})
            </h3>
            <ul className="stack" style={{ gap: "var(--space-xs)", listStyle: "none", padding: 0, margin: 0 }}>
              {overdue.map((a) => (
                <li key={a.id} style={{ fontSize: "var(--text-body)" }}>
                  <Link href="/actions" style={{ textDecoration: "none", color: "var(--colour-text-primary)", fontWeight: 600 }}>
                    {a.title}
                  </Link>
                  <div style={{ fontSize: "var(--text-label)", color: "var(--colour-danger)", marginTop: "2px" }}>
                    Due {new Date(a.dueAt!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Due Today column */}
        {dueToday.length > 0 && (
          <div style={{ border: "1px solid var(--colour-info)", borderRadius: "var(--radius-sm)", padding: "var(--space-md)", background: "rgba(32, 128, 224, 0.04)" }}>
            <h3 style={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--colour-info)", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: "var(--space-sm)" }}>
              ⚡ Due Today ({dueToday.length})
            </h3>
            <ul className="stack" style={{ gap: "var(--space-xs)", listStyle: "none", padding: 0, margin: 0 }}>
              {dueToday.map((a) => (
                <li key={a.id} style={{ fontSize: "var(--text-body)" }}>
                  <Link href="/actions" style={{ textDecoration: "none", color: "var(--colour-text-primary)", fontWeight: 600 }}>
                    {a.title}
                  </Link>
                  {a.priority && a.priority !== "normal" && (
                    <span className={`status status--${a.priority === "critical" ? "risk" : "warn"}`} style={{ fontSize: "9px", padding: "1px 4px", marginLeft: "6px", textTransform: "uppercase" }}>
                      {a.priority}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Followups Due Today column */}
        {followUpToday.length > 0 && (
          <div style={{ border: "1px solid var(--colour-warning)", borderRadius: "var(--radius-sm)", padding: "var(--space-md)", background: "rgba(224, 160, 32, 0.04)" }}>
            <h3 style={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--colour-warning)", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: "var(--space-sm)" }}>
              📅 Follow-ups ({followUpToday.length})
            </h3>
            <ul className="stack" style={{ gap: "var(--space-xs)", listStyle: "none", padding: 0, margin: 0 }}>
              {followUpToday.map((a) => (
                <li key={a.id} style={{ fontSize: "var(--text-body)" }}>
                  <Link href="/actions" style={{ textDecoration: "none", color: "var(--colour-text-primary)", fontWeight: 600 }}>
                    {a.title}
                  </Link>
                  {a.followUpAt && (
                    <div style={{ fontSize: "var(--text-label)", color: "var(--colour-text-secondary)", marginTop: "2px" }}>
                      Scheduled: {new Date(a.followUpAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Waiting On column */}
        {waitingOn.length > 0 && (
          <div style={{ border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "var(--space-md)", background: "var(--colour-surface-secondary)" }}>
            <h3 style={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--colour-text-secondary)", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: "var(--space-sm)" }}>
              ⏳ Waiting On ({waitingOn.length})
            </h3>
            <ul className="stack" style={{ gap: "var(--space-xs)", listStyle: "none", padding: 0, margin: 0 }}>
              {waitingOn.map((a) => (
                <li key={a.id} style={{ fontSize: "var(--text-body)" }}>
                  <Link href="/actions" style={{ textDecoration: "none", color: "var(--colour-text-primary)", fontWeight: 600 }}>
                    {a.title}
                  </Link>
                  {a.followUpAt && (
                    <div style={{ fontSize: "var(--text-label)", color: "var(--colour-text-muted)", marginTop: "2px" }}>
                      Follow-up {new Date(a.followUpAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function DiaryRisksSection({ risks }: { risks: DiaryEntry[] }) {
  if (risks.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: "var(--space-lg)" }}>
      <div className="card-head">
        <div>
          <p className="eyebrow">Diary risks</p>
          <h2 className="card__title">Risks you marked for attention</h2>
        </div>
        <Link href="/diary" className="btn btn--ghost btn--sm">
          Open Diary
        </Link>
      </div>
      <p className="action-card__rationale" style={{ marginTop: 0, marginBottom: "var(--space-md)" }}>
        Active risks from your private diary stay visible here until you mark
        them resolved. The original diary entry remains part of the historical
        record.
      </p>
      <div className="stack" style={{ gap: "var(--space-sm)" }}>
        {risks.slice(0, 5).map((risk) => (
          <article className="memo-item" key={risk.id}>
            <div className="memo-item__main">
              <p className="memo-item__title">
                {risk.transcript || risk.body || "Diary risk"}
              </p>
              <div className="source-ref-row">
                <span className="source-ref">
                  <span className="source-ref__system">Diary</span>
                  <span>{formatTimestamp(risk.createdAt)}</span>
                </span>
              </div>
            </div>
            <div className="memo-item__aside">
              <span className="status status--risk">Active</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default async function BriefingPage() {
  const ctx = await requireTenantContext();
  const supabase = await createSupabaseServerClient();

  const [briefing, peopleInFocus, actions, activeRisksResult, profileResult, activeConnectionsResult] = await Promise.all([
    getLatestBriefing(ctx),
    getPeopleInFocus(),
    listSuggestedActions(ctx.tenantId),
    diaryService.listActiveRisks(ctx),
    supabase
      .from("user_profiles")
      .select("timezone, briefing_time")
      .eq("user_id", ctx.userId)
      .maybeSingle(),
    supabase
      .from("source_connections")
      .select("id")
      .eq("auto_refresh_enabled", true),
  ]);

  const profile = profileResult?.data;
  const activeConnections = activeConnectionsResult?.data;
  const activeRisks = activeRisksResult.ok ? activeRisksResult.value : [];

  const timezone = profile?.timezone ?? "UTC";
  const briefingTime = (profile?.briefing_time as string | null)?.slice(0, 5) ?? "08:00";

  return (
    <main className="workspace__content">
      <div className="page-head">
        <div className="page-head__row">
          <div>
            <p className="eyebrow">Daily briefing</p>
            <h1 className="page-head__title">What matters today</h1>
            <p className="page-head__lead">
              Every morning, know what matters, what changed, what needs
              approval, and what cannot slip — ranked by consequence and
              traceable to source.
            </p>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-xs)" }}>
            <span className="status status--info" style={{ textTransform: "none", fontSize: "var(--text-label)" }}>
              ⏰ Next Briefing: Daily at {briefingTime} ({timezone})
            </span>
            {activeConnections && activeConnections.length > 0 ? (
              <span className="badge badge--plain" style={{ fontSize: "var(--text-micro)" }}>
                Auto-syncing {activeConnections.length} connected {activeConnections.length === 1 ? "source" : "sources"}
              </span>
            ) : (
              <span className="badge" style={{ fontSize: "var(--text-micro)", textTransform: "none", color: "var(--colour-warning)", border: "1px dashed var(--colour-warning)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                ⚠ No sources scheduled to auto-refresh
              </span>
            )}
          </div>
        </div>
      </div>

      <PeopleInFocusSection people={peopleInFocus} />

      <DiaryRisksSection risks={activeRisks} />

      <ActionsAttentionSection actions={actions} />

      {briefing ? (
        /* --- Real briefing ------------------------------------------------ */
        <div className="memo">
          <div className="memo__head">
            <div>
              <p className="memo__kicker">
                Pilot by Paylo.one · Daily briefing
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
        /* --- Premium Schedule Card (no real briefing yet) ---------------- */
        <div style={{
          padding: "var(--space-xl)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          background: "rgba(21, 24, 30, 0.4)",
          backdropFilter: "blur(12px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: "var(--space-md)",
          maxWidth: "640px",
          margin: "var(--space-xl) auto",
          boxShadow: "var(--shadow-pop)"
        }}>
          <div style={{
            fontSize: "40px",
            lineHeight: 1,
            marginBottom: "var(--space-xs)"
          }}>
            ⏰
          </div>
          <h2 style={{
            fontSize: "var(--text-h2)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--colour-text-primary)",
            margin: 0
          }}>
            Daily Briefing rhythm
          </h2>
          <p style={{
            fontSize: "var(--text-body)",
            color: "var(--colour-text-secondary)",
            lineHeight: "var(--leading-normal)",
            maxWidth: "480px",
            margin: 0
          }}>
            Your private daily briefing prepares on a regular schedule. Your next briefing is scheduled for <strong style={{ color: "var(--colour-accent)" }}>{briefingTime} Daily ({timezone})</strong>.
            Pilot will securely process your connected sources to extract commitments, actions, and key decisions.
          </p>

          <div style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "var(--space-md)",
            marginTop: "var(--space-sm)",
            width: "100%",
            maxWidth: "480px",
            borderTop: "1px solid var(--colour-border)",
            paddingTop: "var(--space-lg)"
          }}>
            <form action="" method="get">
              <button type="submit" className="btn btn--primary">
                Check &amp; Sync Now
              </button>
            </form>
            <Link href="/sources" className="btn btn--secondary">
              Configure Sync Feeds
            </Link>
          </div>
        </div>
      )}

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        Your memo is assembled privately from the sources you have connected.
        Nothing is sent or shared on your behalf.
      </p>
    </main>
  );
}
