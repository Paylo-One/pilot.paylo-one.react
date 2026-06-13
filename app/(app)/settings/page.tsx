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
import { listTenantModelProviders } from "@/modules/tenant-models/server";
import { referralService } from "@/modules/referral";
import {
  SettingsProfileForm,
  type ProfileFormValues,
} from "./settings-form";
import { PasskeysCard } from "./passkeys-card";
import { ByoModelCard } from "@/components/settings/byo-model-card";
import { ReferralCard } from "./referral-card";
import { SettingsNav } from "./settings-nav";

type SectionTag = "active" | "read-only" | "planned";

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

  const values: ProfileFormValues = {
    displayName: profile?.display_name ?? "",
    timezone: profile?.timezone ?? "UTC",
    briefingTime: (profile?.briefing_time as string | null)?.slice(0, 5) ?? "",
  };

  // Referral: the signed-in user's personal code + who has joined through it.
  const [referralOverviewRes, referralUsagesRes] = await Promise.all([
    referralService.getOverview(ctx),
    referralService.listUsages(ctx),
  ]);
  const referral = referralOverviewRes.ok ? referralOverviewRes.value : null;
  const referralUsages = referralUsagesRes.ok ? referralUsagesRes.value : [];

  const sections = [
    { id: "workspace", label: "Workspace" },
    { id: "intelligence", label: "Intelligence" },
    { id: "referral", label: "Referral" },
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
            <span className="meta-row__value">
              <span className="status status--ok">Invite-only · active</span>
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
            <span className="meta-row__key">Sensitive content</span>
            <span className="meta-row__value">Checked before anything is sent</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Record kept</span>
            <span className="meta-row__value">What was used, every time</span>
          </div>
        </SectionCard>

        {/* ===== Referral ================================================= */}
        <GroupHeading id="referral">Referral</GroupHeading>

        <SectionCard
          label="Referral"
          title="Invite people to Paylo.one"
          tag="active"
        >
          {referral ? (
            <ReferralCard overview={referral} usages={referralUsages} />
          ) : (
            <p className="action-card__rationale">
              Your reference will be ready in a moment. Refresh to see your
              invitation link.
            </p>
          )}
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

        <SectionCard label="Tool access" title="Connected tools" tag="planned">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            In time, Paylo.one will be able to use a small set of approved tools to
            gather context for you. Tools that only read information run quietly
            and are logged; anything that would change something always waits for
            your approval. This is planned, and switched on with help during
            onboarding rather than by default.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Tools that only read</span>
            <span className="meta-row__value">
              <span className="status status--ok">Allowed and logged</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Tools that make changes</span>
            <span className="meta-row__value">
              <span className="status status--warn">Need your approval</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Scope</span>
            <span className="meta-row__value">Your workspace only</span>
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
        </SectionCard>

        </div>
      </div>
    </main>
  );
}
