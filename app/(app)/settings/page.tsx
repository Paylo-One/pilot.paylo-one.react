/**
 * Settings — workspace identity, profile, model use, security and privacy,
 * referral, tool access, and trust. Admin views live in the separate /admin
 * project and are intentionally not exposed in the user app.
 * Governance: multi-tenancy-design.md (tenant/subdomain), security-and-privacy.md
 * (storage + retention), authentication-architecture.md (passkeys),
 * model-inference-architecture.md (model use), product/access-and-invitations.md
 * (referrals), audit-and-source-traceability.md (audit).
 *
 * Server component. Interactive sections (profile, your own model key, passkeys)
 * are tagged "Available". The referral section is read-only here — the code is
 * created automatically and consumed during others' onboarding. Sections that
 * describe enforced behaviour you can read but not change are tagged "Read
 * only". Features that are not open yet are tagged "Planned".
 */

import {
  requireTenantContext,
  getSignedInUser,
} from "@/modules/identity-tenant/server";
import { AVAILABILITY_LABELS, AVAILABILITY_TONE } from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEuInference } from "@/lib/llm";
import { listTenantModelProviders } from "@/modules/tenant-models/server";
import { referralService } from "@/modules/referral";
import { modelUsageCostService } from "@/modules/model-usage-cost";
import { listMcpGrants } from "@/modules/mcp";
import {
  SettingsProfileForm,
  type ProfileFormValues,
} from "./settings-form";
import { PasskeysCard } from "./passkeys-card";
import { ByoModelCard } from "@/components/settings/byo-model-card";
import { OnboardingLauncher } from "@/components/settings/onboarding-launcher";
import { SettingsNav } from "./settings-nav";
import { COMPANY_DETAILS } from "@/lib/company";

type SectionTag = "active" | "read-only" | "planned";

const TOKEN_FMT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function formatUsd(value: number): string {
  // Pilot per-tenant spend is small; keep sub-cent figures legible without
  // dropping them to "$0.00".
  const fractionDigits = value > 0 && value < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

const TAG_TONE: Record<SectionTag, string> = {
  active: "ok",
  "read-only": "info",
  planned: "info",
};

const TAG_LABELS: Record<SectionTag, string> = {
  active: "Available",
  "read-only": "Read only",
  planned: "Planned",
};

function SectionCard({
  label,
  title,
  tag,
  children,
}: {
  label: string;
  title: string;
  tag?: SectionTag;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`card${tag === "planned" ? " card--planned" : ""}`}
      style={{ maxWidth: "680px" }}
    >
      <div className="card-head">
        <div>
          <p className="eyebrow">{label}</p>
          <h2 className="card__title">{title}</h2>
        </div>
        {tag ? (
          <span className={`status status--${TAG_TONE[tag]}`}>
            {TAG_LABELS[tag]}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function GroupHeading({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="settings-group-heading eyebrow"
      style={{ marginTop: "var(--space-lg)", marginBottom: "calc(var(--space-sm) * -1)" }}
    >
      {children}
    </h2>
  );
}

export default async function SettingsPage() {
  const ctx = await requireTenantContext();
  const user = await getSignedInUser();

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name, timezone, briefing_time")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  const providersRes = await listTenantModelProviders(ctx);
  const providers = providersRes.ok ? providersRes.value : [];
  const mcpGrants = await listMcpGrants(ctx);
  const activeMcpGrants = mcpGrants.filter((grant) => grant.status === "active");

  const usageRes = await modelUsageCostService.summarize(ctx, { windowDays: 30 });
  const usage = usageRes.ok ? usageRes.value : null;
  const topModel = usage?.byModel[0] ?? null;

  const values: ProfileFormValues = {
    displayName: profile?.display_name ?? "",
    timezone: profile?.timezone ?? "UTC",
    briefingTime: (profile?.briefing_time as string | null)?.slice(0, 5) ?? "",
  };

  // Invitations: a slim summary here; the full experience lives at /invitations.
  const referralOverviewRes = await referralService.getOverview(ctx);
  const referral = referralOverviewRes.ok ? referralOverviewRes.value : null;
  const invitationSummary = referral
    ? referral.status === "suspended"
      ? "Link paused"
      : referral.limitReached
        ? "Invitation limit reached"
        : `${referral.remaining} ${
            referral.remaining === 1 ? "invitation" : "invitations"
          } available`
    : null;

  const sections = [
    { id: "workspace", label: "Workspace" },
    { id: "intelligence", label: "Intelligence" },
    { id: "invitations", label: "Invitations" },
    { id: "security", label: "Security & privacy" },
    { id: "tools", label: "Tool access & trust" },
  ];

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Settings</p>
        <h1 className="page-head__title">Workspace &amp; controls</h1>
        <p className="page-head__lead">
          Your workspace identity, the intelligence that powers it, your security
          and privacy posture, and the trust guarantees underneath. You can see,
          export, and delete your data; you stay in command.
        </p>
      </div>

      <div className="settings-layout">
        <SettingsNav sections={sections} />

        <div className="stack" style={{ gap: "var(--space-md)" }}>
        {/* ===== Workspace & you ========================================== */}
        <GroupHeading id="workspace">Workspace &amp; you</GroupHeading>

        <SectionCard label="Tenant" title="Workspace">
          <div className="meta-row">
            <span className="meta-row__key">Subdomain</span>
            <span className="meta-row__value mono">{ctx.tenantSlug}.paylo.one</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Signed in as</span>
            <span className="meta-row__value mono">{user?.email ?? "—"}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Role</span>
            <span className="meta-row__value">
              <span className="badge">{ctx.role}</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Onboarding</span>
            <span
              className="meta-row__value"
              style={{
                display: "flex",
                gap: "var(--space-sm)",
                alignItems: "center",
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <span className="status status--ok">Invite-only · active</span>
              <OnboardingLauncher profile={profile} />
            </span>
          </div>
        </SectionCard>

        <SectionCard label="Profile" title="Your profile" tag="active">
          <SettingsProfileForm values={values} />
        </SectionCard>

        {/* ===== Intelligence ============================================= */}
        <GroupHeading id="intelligence">Intelligence</GroupHeading>

        <SectionCard label="Model provider" title="Bring your own key" tag="active">
          <ByoModelCard providers={providers} />
        </SectionCard>

        <SectionCard label="Model use" title="How your AI is run" tag="read-only">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            Every request is checked against your plan and how sensitive the
            content is before any model is used. When you add your own key above,
            it is used first; otherwise Paylo.one uses its own secure default.
            {!providers.some((p) => p.isActive) && isEuInference()
              ? " That default runs inside the European Union, on infrastructure in Frankfurt, using European AI models under GDPR — never used to train external models."
              : ""}
          </p>
          <div className="meta-row">
            <span className="meta-row__key">In use now</span>
            <span className="meta-row__value">
              <span className="badge badge--plain">
                {providers.some((p) => p.isActive) ? "Your own key" : "Paylo.one default"}
              </span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Where it runs</span>
            <span className="meta-row__value">
              {providers.some((p) => p.isActive)
                ? "Your own provider"
                : isEuInference()
                  ? "European Union (Frankfurt)"
                  : "Secure default"}
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Sensitive content</span>
            <span className="meta-row__value">Checked before anything is sent</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Record kept</span>
            <span className="meta-row__value">What was used, every time</span>
          </div>
        </SectionCard>

        <SectionCard label="Model usage" title="Usage &amp; estimated cost" tag="read-only">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            A running view of how much AI you&rsquo;ve used in the last 30 days,
            with an estimated cost. Figures cover briefings, agent runs, and
            background linking; they exclude any calls made through your own key.
          </p>
          {usage && usage.calls > 0 ? (
            <>
              <div className="meta-row">
                <span className="meta-row__key">Model calls</span>
                <span className="meta-row__value">
                  {usage.calls.toLocaleString("en-US")}
                  {usage.failedCalls > 0 ? (
                    <span className="status status--warn" style={{ marginLeft: "var(--space-sm)" }}>
                      {usage.failedCalls} failed
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="meta-row">
                <span className="meta-row__key">Tokens used</span>
                <span className="meta-row__value mono">{TOKEN_FMT.format(usage.totalTokens)}</span>
              </div>
              <div className="meta-row">
                <span className="meta-row__key">Estimated cost</span>
                <span className="meta-row__value mono">{formatUsd(usage.estCostUsd)}</span>
              </div>
              {topModel ? (
                <div className="meta-row">
                  <span className="meta-row__key">Most-used model</span>
                  <span className="meta-row__value">
                    <span className="badge badge--plain">{topModel.modelId}</span>
                  </span>
                </div>
              ) : null}
              {usage.truncated ? (
                <p className="action-card__rationale" style={{ marginTop: "var(--space-sm)", opacity: 0.8 }}>
                  Showing the most recent activity in this window; totals are a
                  lower bound.
                </p>
              ) : null}
            </>
          ) : (
            <div className="meta-row">
              <span className="meta-row__key">Activity</span>
              <span className="meta-row__value">
                {usage ? "No model activity yet in this window" : "Temporarily unavailable"}
              </span>
            </div>
          )}
        </SectionCard>

        {/* ===== Invitations ============================================= */}
        <GroupHeading id="invitations">Invitations</GroupHeading>

        <SectionCard
          label="Invitations"
          title="Your private invitation link"
          tag="active"
        >
          <p
            className="action-card__rationale"
            style={{ marginBottom: "var(--space-md)" }}
          >
            Paylo One is invite-only. Your link lets the people you choose
            request their own workspace. Manage it, copy it, and see who&rsquo;s
            joined on the Invitations page.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Status</span>
            <span
              className="meta-row__value"
              style={{
                display: "flex",
                gap: "var(--space-sm)",
                alignItems: "center",
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              {invitationSummary ? (
                <span
                  className={`status status--${
                    referral?.status === "suspended"
                      ? "neutral"
                      : referral?.limitReached
                        ? "warn"
                        : "ok"
                  }`}
                >
                  {invitationSummary}
                </span>
              ) : (
                <span className="status status--info">Preparing</span>
              )}
              <a className="btn btn--ghost btn--sm" href="/invitations">
                Manage invitations
              </a>
            </span>
          </div>
        </SectionCard>

        {/* ===== Security & privacy ======================================= */}
        <GroupHeading id="security">Security &amp; privacy</GroupHeading>

        <SectionCard label="Security" title="Passkey authentication" tag="active">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            One passkey works across every &lt;slug&gt;.paylo.one workspace (RP ID
            = the registrable domain). Enrol at least two — on separate devices —
            so losing one is a non-event.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Sign-in methods</span>
            <span className="meta-row__value">
              <span className="badge badge--plain">passkey · magic link fallback</span>
            </span>
          </div>
          <PasskeysCard />
        </SectionCard>

        <SectionCard label="Privacy" title="Storage &amp; retention" tag="read-only">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            Each source carries its own storage policy. We store the least we can
            to deliver value; the conservative default is summaries only.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Default storage policy</span>
            <span className="meta-row__value">
              <span className="badge badge--plain">summaries only</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Raw retention window</span>
            <span className="meta-row__value mono">discard after processing</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Export &amp; delete</span>
            <span
              className="meta-row__value"
              style={{
                display: "flex",
                gap: "var(--space-sm)",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              <span className={`status status--${AVAILABILITY_TONE.coming_soon}`}>
                {AVAILABILITY_LABELS.coming_soon}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" disabled title="Export and delete are coming soon">
                Request export
              </button>
            </span>
          </div>
        </SectionCard>

        {/* ===== Tool access & trust ====================================== */}
        <GroupHeading id="tools">Tool access &amp; trust</GroupHeading>

        <SectionCard label="Tool access" title="Connected MCP clients" tag="active">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            Approved clients can use Pilot memory through MCP after you grant
            access. Each grant is scoped to this workspace, logged, and
            revocable.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Active clients</span>
            <span className="meta-row__value">
              <span className="status status--ok">{activeMcpGrants.length} connected</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Write access</span>
            <span className="meta-row__value">
              <span className="status status--warn">Scope-gated</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Scope</span>
            <span className="meta-row__value">
              <a className="btn btn--ghost btn--sm" href="/mcp">
                Manage MCP Access
              </a>
            </span>
          </div>
        </SectionCard>

        <SectionCard label="Trust" title="Activity log &amp; sources" tag="read-only">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            Every AI insight shows where it came from, and every change — sign-in,
            source and key changes, prompt edits, model use — is written to a
            private activity log that cannot be edited after the fact.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Activity log</span>
            <span className="meta-row__value">Kept, and cannot be edited</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Source references</span>
            <span className="meta-row__value">Required on every insight</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Company registration</span>
            <span className="meta-row__value mono">
              {COMPANY_DETAILS.legalName} · {COMPANY_DETAILS.kvkLabel}
            </span>
          </div>
        </SectionCard>

        </div>
      </div>
    </main>
  );
}
