/**
 * Briefing — Screen 1, the Daily Memo (the wedge). product/daily-memo.md.
 *
 * Server Component. Reads the latest briefing for the tenant through the USER
 * server client (RLS active), alongside the real, correlation-derived inputs
 * that make the surface useful even before a memo exists: the people behind
 * recent activity, active diary risks, and commitments that need follow-through.
 *
 * The page reads top-down by consequence — a calm masthead, a triage strip that
 * answers "how much needs me today", one prioritised attention queue, then the
 * editorial memo and its supporting context. Every insight carries its source
 * references (the trust contract). The memo is editorial, not a dashboard dump.
 */

import Link from "next/link";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  getLatestBriefing,
  getPeopleInFocus,
  type BriefingSectionView,
  type PersonInFocus,
} from "@/modules/briefing/server";
import {
  listSuggestedActions,
  type SuggestedActionView,
} from "@/modules/action-extraction/server";
import { diaryService, type DiaryEntry } from "@/modules/diary";
import { sourceSystemLabel } from "@/modules/source-connection";
import {
  IMPORTANCE_LABELS,
  IMPORTANCE_TONE,
} from "@/modules/people/people.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { referralService } from "@/modules/referral";
import { InvitationStrip } from "@/components/invitations/invitation-strip";
import { RefinementActions } from "@/components/refinement/refinement-actions";
import { FeedbackChip } from "@/components/refinement/feedback-chip";
import { NewsFeedbackBar } from "@/components/news/news-feedback-bar";
import { NEWS_CATEGORY_LABELS, type ExternalSignalView } from "@/modules/news";
import { calendarDayInTimeZone, hourInTimeZone } from "@/lib/tz-day";
import { MemoSourceReference } from "@/components/briefing/source-reference";
import { listSavedFeedbackTargets } from "@/modules/refinement/server";
import { MemoActionDraft } from "@/components/briefing/memo-action-draft";

/* --- Formatting ----------------------------------------------------------- */

function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTime(value: string | null, timezone: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function formatDate(value: string | null, timezone: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  });
}

function titleCase(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* --- Attention queue model ------------------------------------------------ */

type WhenTone = "overdue" | "today" | "soon" | "neutral";

interface AttentionItem {
  readonly id: string;
  readonly title: string;
  readonly when: string;
  readonly whenTone: WhenTone;
  readonly status: { label: string; tone: "risk" | "warn" | "info" | "neutral" };
  readonly meta?: string;
  readonly rank: number;
}

/**
 * Collapse the real action statuses into one prioritised queue: overdue first,
 * then due today, then follow-ups owed, then what you're waiting on. This is the
 * single "what needs me" surface — not four competing coloured boxes.
 *
 * "Overdue" and "due today" are judged against the operator's local calendar
 * day (via `timezone`), not the UTC server clock — otherwise a due date shifts
 * by a day near midnight and the triage lies.
 */
function buildAttention(
  actions: SuggestedActionView[],
  now: Date,
  timezone: string,
): AttentionItem[] {
  const today = calendarDayInTimeZone(now, timezone);
  const dayOf = (s: string) => calendarDayInTimeZone(new Date(s), timezone);
  const isPast = (s: string) => dayOf(s) < today;
  const isToday = (s: string) => dayOf(s) === today;
  const live = (a: SuggestedActionView) =>
    a.status !== "completed" && a.status !== "cancelled";

  const items: AttentionItem[] = [];

  for (const a of actions) {
    if (!live(a)) continue;

    if (a.dueAt && isPast(a.dueAt) && (a.status === "planned" || a.status === "in_progress")) {
      items.push({
        id: a.id,
        title: a.title,
        when: "Overdue",
        whenTone: "overdue",
        status: { label: "Overdue", tone: "risk" },
        meta: `Was due ${formatDate(a.dueAt, timezone)}`,
        rank: 0,
      });
      continue;
    }
    if (a.dueAt && isToday(a.dueAt)) {
      items.push({
        id: a.id,
        title: a.title,
        when: "Due today",
        whenTone: "today",
        status:
          a.priority === "critical"
            ? { label: "Critical", tone: "risk" }
            : a.priority === "high"
              ? { label: "High", tone: "warn" }
              : { label: "Today", tone: "warn" },
        rank: 1,
      });
      continue;
    }
    if (a.status === "follow_up" || (a.followUpAt && (isPast(a.followUpAt) || isToday(a.followUpAt)))) {
      items.push({
        id: a.id,
        title: a.title,
        when: "Follow-up",
        whenTone: "today",
        status: { label: "Follow up", tone: "info" },
        meta: a.followUpAt ? `Scheduled ${formatDate(a.followUpAt, timezone)}` : undefined,
        rank: 2,
      });
      continue;
    }
    if (a.status === "waiting") {
      items.push({
        id: a.id,
        title: a.title,
        when: "Waiting on",
        whenTone: "neutral",
        status: { label: "Waiting", tone: "neutral" },
        meta: a.followUpAt ? `Chase ${formatDate(a.followUpAt, timezone)}` : undefined,
        rank: 3,
      });
    }
  }

  return items.sort((a, b) => a.rank - b.rank);
}

/* --- Triage strip --------------------------------------------------------- */

function TriageItem({
  href,
  count,
  label,
  tone,
}: {
  href: string;
  count: number;
  label: string;
  tone?: "alert" | "warn" | "muted";
}) {
  const cls = count === 0 ? "muted" : tone;
  return (
    <Link href={href} className={`triage__item${cls ? ` triage__item--${cls}` : ""}`}>
      <span className="triage__count">{count}</span>
      <span className="triage__label">{label}</span>
    </Link>
  );
}

/* --- Lane placeholder — explains what will populate a section ------------- */

function LanePlaceholder({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="all-clear">
      <span className="all-clear__mark all-clear__mark--neutral" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="all-clear__title">{title}</p>
        <p className="all-clear__body">{children}</p>
      </div>
    </div>
  );
}

/* --- Attention queue ------------------------------------------------------ */

function AttentionSection({
  items,
  hasAnyActions,
}: {
  items: AttentionItem[];
  hasAnyActions: boolean;
}) {
  return (
    <section id="attention" className="card">
      <div className="briefing-section__head">
        <div>
          <p className="eyebrow">Needs you today</p>
          <h2 className="card__title">Commitments and decisions to clear</h2>
        </div>
        {hasAnyActions ? (
          <Link href="/actions" className="btn btn--ghost btn--sm">
            Open Actions
          </Link>
        ) : null}
      </div>

      {items.length === 0 && hasAnyActions ? (
        <div className="all-clear">
          <span className="all-clear__mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <div>
            <p className="all-clear__title">Nothing needs you right now</p>
            <p className="all-clear__body">
              No commitments are overdue or due today. New items will appear here
              the moment your sources surface them.
            </p>
          </div>
        </div>
      ) : items.length === 0 ? (
        <LanePlaceholder
          title="Your commitments will appear here"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3 8-8" />
              <path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          }
        >
          As Pilot reads your sources, anything you&apos;ve promised, need to
          decide, or have to follow up on shows up here — ranked by what&apos;s
          most pressing.
        </LanePlaceholder>
      ) : (
        <div className="attention-list">
          {items.map((item) => (
            <article className="attention-row" key={item.id}>
              <div className={`attention-row__when attention-row__when--${item.whenTone}`}>
                {item.when}
              </div>
              <div className="attention-row__main">
                <p>
                  <Link href="/actions" className="attention-row__title">
                    {item.title}
                  </Link>
                </p>
                {item.meta ? <p className="attention-row__meta">{item.meta}</p> : null}
              </div>
              <div className="memo-item__aside">
                <span className={`status status--${item.status.tone}`}>
                  {item.status.label}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/* --- Risks you're tracking (private diary) -------------------------------- */

function RisksSection({ risks, timezone }: { risks: DiaryEntry[]; timezone: string }) {
  return (
    <section id="risks" className="card">
      <div className="briefing-section__head">
        <div>
          <p className="eyebrow">Open risks</p>
          <h2 className="card__title">Risks you flagged to keep watching</h2>
        </div>
        <Link href="/diary" className="btn btn--ghost btn--sm">
          Open Diary
        </Link>
      </div>

      {risks.length === 0 ? (
        <LanePlaceholder
          title="Risks you're tracking will appear here"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 22V4a1 1 0 0 1 1-1h13l-3 5 3 5H5" />
            </svg>
          }
        >
          Flag a risk in your diary and it stays in view here until you mark it
          resolved. Your diary stays private to you.
        </LanePlaceholder>
      ) : (
        <>
          <p className="briefing-section__lead">
            These stay in view until you mark them resolved. They remain private
            to you — only you can see your diary.
          </p>
          <div className="attention-list">
            {risks.slice(0, 5).map((risk) => (
              <article className="attention-row" key={risk.id}>
                <div className="attention-row__when">{formatDate(risk.createdAt, timezone)}</div>
                <div className="attention-row__main">
                  <p className="attention-row__title">
                    {risk.transcript || risk.body || "Diary risk"}
                  </p>
                </div>
                <div className="memo-item__aside">
                  <span className="status status--risk">Active</span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* --- People in focus ------------------------------------------------------ */

function PeopleSection({ people }: { people: PersonInFocus[] }) {
  return (
    <section id="people" className="card">
      <div className="briefing-section__head">
        <div>
          <p className="eyebrow">People in focus</p>
          <h2 className="card__title">Who is behind today&apos;s activity</h2>
        </div>
        {people.length > 0 ? (
          <Link href="/people" className="btn btn--ghost btn--sm">
            Open People
          </Link>
        ) : null}
      </div>

      {people.length === 0 ? (
        <LanePlaceholder
          title="The people behind your work will appear here"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
        >
          Once your sources are connected and read, Pilot surfaces who is driving
          today&apos;s activity, ranked by the importance you set.
        </LanePlaceholder>
      ) : null}

      {people.length === 0 ? null : (
      <>
      <p className="briefing-section__lead">
        Correlated from your connected sources by each person&apos;s verified
        identities, ranked by the importance you set.
      </p>
      <div className="stack" style={{ gap: "var(--space-md)" }}>
        {people.map((p) => (
          <div className="memo-item" key={p.personId}>
            <div className="memo-item__main">
              <p className="memo-item__title">
                <Link href="/people" className="source-ref__system">
                  {p.name}
                </Link>
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
                      {sourceSystemLabel(s.system)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{s.title.length > 40 ? `${s.title.slice(0, 39)}…` : s.title}</span>
                    <span className="source-ref__confidence">{Math.round(s.confidence * 100)}%</span>
                  </span>
                ))}
              </div>
              <div className="refinement-actions">
                <span className="refinement-actions__label mono">Feedback</span>
                <FeedbackChip feedback="not_relevant" targetType="person" targetId={p.personId} label="Not relevant today" />
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
      </>
      )}
    </section>
  );
}

/* --- The memo ------------------------------------------------------------- */

function RealReferences({
  section,
  timezone,
}: {
  section: BriefingSectionView;
  timezone: string;
}) {
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
      <div className="source-ref-row" aria-label="Sources for this briefing section">
        {section.references.map((ref) => (
          <MemoSourceReference key={ref.id} reference={ref} timezone={timezone} />
        ))}
      </div>
    </>
  );
}

function ExternalSignals({
  signals,
  timezone,
}: {
  signals: readonly ExternalSignalView[];
  timezone: string;
}) {
  if (signals.length === 0) return null;
  return (
    <section className="memo__section">
      <div className="memo__section-head">
        <span className="memo__section-title">Signals worth knowing</span>
      </div>
      {signals.map((signal) => (
        <article className="memo-item" key={signal.briefingItemId}>
          <div className="memo-item__main">
            <p className="memo-item__title">
              <a href={signal.canonicalUrl} target="_blank" rel="noreferrer" className="source-ref__system">
                {signal.headline}
              </a>
            </p>
            {signal.summary ? <p className="memo-item__detail">{signal.summary}</p> : null}
            <p className="memo-item__detail">
              <strong>Why it matters:</strong> {signal.whyItMatters}
            </p>
            <div className="source-ref-row">
              <span className="source-ref">
                <span className="source-ref__system">{signal.sourceName}</span>
                {signal.publishedAt ? <span>{formatDate(signal.publishedAt, timezone)}</span> : null}
              </span>
              {signal.category ? (
                <span className="chip">{NEWS_CATEGORY_LABELS[signal.category]}</span>
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

/* --- Page ----------------------------------------------------------------- */

export default async function BriefingPage() {
  const ctx = await requireTenantContext();
  const supabase = await createSupabaseServerClient();

  const [briefing, peopleInFocus, actions, activeRisksResult, profileResult, connectionsResult, referralResult] =
    await Promise.all([
      getLatestBriefing(ctx),
      getPeopleInFocus(),
      listSuggestedActions(ctx.tenantId),
      diaryService.listActiveRisks(ctx),
      supabase
        .from("user_profiles")
        .select("display_name, timezone, briefing_time")
        .eq("user_id", ctx.userId)
        .maybeSingle(),
      supabase.from("source_connections").select("id, auto_refresh_enabled"),
      referralService.getOverview(ctx),
    ]);

  const referral = referralResult.ok ? referralResult.value : null;

  const profile = profileResult?.data;
  const connections = connectionsResult?.data ?? [];
  const activeRisks = activeRisksResult.ok ? activeRisksResult.value : [];

  const name = firstName(profile?.display_name as string | null);
  const timezone = profile?.timezone ?? "UTC";
  const briefingTime = (profile?.briefing_time as string | null)?.slice(0, 5) ?? "08:00";
  const autoRefreshCount = connections.filter((c) => c.auto_refresh_enabled).length;
  const hasSources = connections.length > 0;

  const now = new Date();
  const localHour = hourInTimeZone(now, timezone);
  const attention = buildAttention(actions, now, timezone);
  const isStale = briefing?.status === "stale";
  let savedMemoFeedback: ReadonlySet<string> | null = null;
  try {
    savedMemoFeedback = await listSavedFeedbackTargets(
      ctx,
      "memo_section",
      "not_relevant",
      briefing?.sections.map((section) => section.id) ?? [],
    );
  } catch (error) {
    console.error("[briefing] failed to establish saved memo feedback state", error);
  }

  /* -- State: no connected sources -- */
  if (!hasSources) {
    return (
      <main className="workspace__content">
        <div className="briefing">
          <header className="briefing__masthead">
            <div>
              <p className="eyebrow">Daily briefing</p>
              <h1 className="briefing__title">
                {greeting(localHour)}
                {name ? `, ${name}` : ""}.
              </h1>
              <p className="briefing__lead">
                Your briefing reads your work for you and tells you what needs a
                decision, what&apos;s at risk, and what you can leave. Connect a
                source to begin.
              </p>
            </div>
          </header>

          <div className="briefing-onboard">
            <h2 className="briefing-onboard__title">Set up your first briefing</h2>
            <p className="briefing-onboard__body">
              Pilot reads only the sources you connect, assembles your briefing
              privately, and never acts on your behalf.
            </p>
            <ol className="briefing-onboard__steps">
              <li className="briefing-onboard__step">
                <span className="briefing-onboard__num">1</span>
                <div>
                  <p className="briefing-onboard__step-title">Connect a source</p>
                  <p className="briefing-onboard__step-body">
                    Link your email, calendar, or workspace. You stay in control
                    of what Pilot can read.
                  </p>
                </div>
              </li>
              <li className="briefing-onboard__step">
                <span className="briefing-onboard__num">2</span>
                <div>
                  <p className="briefing-onboard__step-title">Pilot reads the last few days</p>
                  <p className="briefing-onboard__step-body">
                    It finds commitments, decisions, and risks across everything
                    you connected.
                  </p>
                </div>
              </li>
              <li className="briefing-onboard__step">
                <span className="briefing-onboard__num">3</span>
                <div>
                  <p className="briefing-onboard__step-title">Read your briefing each morning</p>
                  <p className="briefing-onboard__step-body">
                    Delivered at {briefingTime} in your timezone, ranked by
                    consequence and traceable to source.
                  </p>
                </div>
              </li>
            </ol>
            <div className="briefing-onboard__cta">
              <Link href="/sources" className="btn btn--primary">
                Connect a source
              </Link>
            </div>
          </div>

          <Assurance />
        </div>
      </main>
    );
  }

  return (
    <main className="workspace__content">
      <div className="briefing">
        {/* -- Masthead -- */}
        <header className="briefing__masthead">
          <div>
            <p className="eyebrow">Daily briefing</p>
            <h1 className="briefing__title">
              {greeting(localHour)}
              {name ? `, ${name}` : ""}.
            </h1>
            <p className="briefing__lead">
              What needs you today — decisions, risks, and follow-ups, ranked by
              consequence and traceable to source.
            </p>
            <p className="briefing__statusline">
              {briefing ? (
                isStale ? (
                  <>
                    <span className="dot dot--stale" aria-hidden="true" />
                    Updated {formatTime(briefing.generatedAt, timezone)} · newer activity available
                  </>
                ) : (
                  <>
                    <span className="dot dot--ready" aria-hidden="true" />
                    Prepared {formatTime(briefing.generatedAt, timezone)} · private to {ctx.tenantSlug}.paylo.one
                  </>
                )
              ) : (
                <>
                  <span className="dot dot--scheduled" aria-hidden="true" />
                  Next briefing at {briefingTime} · {timezone}
                </>
              )}
            </p>
          </div>

          <div className="briefing__actions">
            <form action="" method="get">
              <button type="submit" className="btn btn--secondary">
                Refresh
              </button>
            </form>
          </div>
        </header>

        {isStale ? (
          <div className="stale-banner">
            <span className="stale-banner__text">
              <span className="dot dot--stale" aria-hidden="true" />
              Your sources have changed since this briefing was prepared.
            </span>
            <form action="" method="get">
              <button type="submit" className="btn btn--ghost btn--sm">
                Refresh now
              </button>
            </form>
          </div>
        ) : null}

        {/* -- Triage strip -- */}
        <nav className="triage" aria-label="Today at a glance">
          <TriageItem
            href="#attention"
            count={attention.length}
            label={attention.length === 1 ? "Needs you" : "Need you"}
            tone={attention.some((i) => i.whenTone === "overdue") ? "alert" : "warn"}
          />
          <TriageItem href="#risks" count={activeRisks.length} label="Open risks" tone="alert" />
          <TriageItem href="#people" count={peopleInFocus.length} label="People in focus" />
          {briefing ? (
            <TriageItem href="#memo" count={briefing.externalSignals.length} label="New signals" tone="muted" />
          ) : null}
        </nav>

        {/* -- Invite-only access -- */}
        {referral ? <InvitationStrip overview={referral} /> : null}

        {/* -- Priority lane -- */}
        <AttentionSection items={attention} hasAnyActions={actions.length > 0} />

        <RisksSection risks={activeRisks} timezone={timezone} />

        {/* -- The memo -- */}
        {briefing ? (
          <div className="memo" id="memo">
            <div className="memo__head">
              <div>
                <p className="memo__kicker">Pilot · Daily briefing</p>
                <h2 className="memo__title">Your briefing</h2>
                <p className="memo__meta">
                  Prepared {formatTime(briefing.generatedAt, timezone)} · {timezone}
                </p>
              </div>
            </div>

            {briefing.summary ? (
              <section className="memo__section memo__section--focus">
                <div className="memo__section-head">
                  <span className="memo__section-title">In a sentence</span>
                </div>
                <p className="memo__summary">{briefing.summary}</p>
              </section>
            ) : null}

            {briefing.sections.map((section) => (
              <section className="memo__section" key={section.id}>
                <div className="memo__section-head">
                  <span className="memo__section-title">{titleCase(section.kind)}</span>
                </div>
                {section.title ? <p className="memo-item__title">{section.title}</p> : null}
                {section.body ? (
                  <p className="memo__summary" style={{ whiteSpace: "pre-wrap", marginTop: "var(--space-sm)" }}>
                    {section.body}
                  </p>
                ) : null}
                <RealReferences section={section} timezone={timezone} />
                <div className="refinement-actions">
                  <MemoActionDraft
                    title={section.title || `Follow up: ${titleCase(section.kind)}`}
                    note={section.body ?? ""}
                    contextId={`${ctx.tenantId}:${ctx.userId}`}
                    briefingSectionId={section.id}
                  />
                </div>
                <RefinementActions
                  targetType="memo_section"
                  targetId={section.id}
                  savedFeedback={savedMemoFeedback?.has(section.id) ? ["not_relevant"] : []}
                  unavailable={savedMemoFeedback === null}
                />
              </section>
            ))}

            <ExternalSignals signals={briefing.externalSignals} timezone={timezone} />
          </div>
        ) : (
          <div className="briefing-onboard" id="memo">
            <h2 className="briefing-onboard__title">Your first briefing is on its way</h2>
            <p className="briefing-onboard__body">
              {autoRefreshCount > 0 ? (
                <>
                  Pilot is watching {autoRefreshCount} connected{" "}
                  {autoRefreshCount === 1 ? "source" : "sources"} and will deliver
                  your first briefing at {briefingTime} in your timezone. Anything
                  urgent already appears above.
                </>
              ) : (
                <>
                  Your sources are connected but none are set to keep themselves
                  current. Turn on automatic refresh so your briefing arrives at{" "}
                  {briefingTime} each day. Anything urgent already appears above.
                </>
              )}
            </p>
            <div className="briefing-onboard__cta">
              <Link href="/sources" className="btn btn--secondary">
                Review your sources
              </Link>
            </div>
          </div>
        )}

        {/* -- Supporting context -- */}
        <PeopleSection people={peopleInFocus} />

        <Assurance />
      </div>
    </main>
  );
}

function Assurance() {
  return (
    <p className="briefing__assurance">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      Your briefing is assembled privately from the sources you connect. Nothing
      is sent or shared on your behalf.
    </p>
  );
}
