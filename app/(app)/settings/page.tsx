/**
 * Settings — workspace, profile, intelligence (model provider + routing),
 * security, privacy, tool layer, and trust. Governance: multi-tenancy-design.md
 * (tenant/subdomain), security-and-privacy.md (storage + retention),
 * authentication-architecture.md (passkeys), model-inference-architecture.md +
 * ADR-038 (model routing & bring-your-own-key), mcp-tool-architecture.md (tool
 * permissions), audit-and-source-traceability.md (audit).
 *
 * Server component. Wired & interactive: workspace identity, profile, the
 * bring-your-own-key model provider, and passkeys. The routing, privacy, tool,
 * and trust panels describe enforced platform behaviour as read-only policy;
 * controls not yet actionable in this build are marked "soon".
 */

import {
  requireTenantContext,
  getSignedInUser,
} from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listTenantModelProviders } from "@/modules/tenant-models/server";
import {
  SettingsProfileForm,
  type ProfileFormValues,
} from "./settings-form";
import { PasskeysCard } from "./passkeys-card";
import { ByoModelCard } from "@/components/settings/byo-model-card";

type SectionTag = "active" | "read-only" | "soon";

const TAG_TONE: Record<SectionTag, string> = {
  active: "ok",
  "read-only": "info",
  soon: "neutral",
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
    <section className="card" style={{ maxWidth: "680px" }}>
      <div className="card-head">
        <div>
          <p className="eyebrow">{label}</p>
          <h2 className="card__title">{title}</h2>
        </div>
        {tag ? <span className={`status status--${TAG_TONE[tag]}`}>{tag}</span> : null}
      </div>
      {children}
    </section>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="eyebrow"
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

      <div className="stack" style={{ gap: "var(--space-md)" }}>
        {/* ===== Workspace & you ========================================== */}
        <GroupHeading>Workspace &amp; you</GroupHeading>

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
        <GroupHeading>Intelligence</GroupHeading>

        <SectionCard label="Model provider" title="Bring your own key" tag="active">
          <ByoModelCard providers={providers} />
        </SectionCard>

        <SectionCard label="Routing" title="Model routing &amp; data policy" tag="read-only">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            Tasks declare a policy, not a model. Every call runs through the Model
            Gateway, which checks entitlement and data classification before any
            tokens are spent. Your own key, when active above, takes priority over
            the hosted default.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Active routing</span>
            <span className="meta-row__value">
              <span className="badge badge--plain">
                {providers.some((p) => p.isActive) ? "your key · priority" : "Paylo-hosted default"}
              </span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Sensitive content</span>
            <span className="meta-row__value mono">classification-gated before routing</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Per-call provenance</span>
            <span className="meta-row__value mono">prompt + model version recorded</span>
          </div>
        </SectionCard>

        {/* ===== Security & privacy ======================================= */}
        <GroupHeading>Security &amp; privacy</GroupHeading>

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
            <span className="meta-row__value">
              <button type="button" className="btn btn--ghost btn--sm" disabled title="Coming soon">
                Request export
              </button>
            </span>
          </div>
        </SectionCard>

        {/* ===== Tool layer & trust ======================================= */}
        <GroupHeading>Tool layer &amp; trust</GroupHeading>

        <SectionCard label="Tenant tool layer" title="MCP permissions" tag="soon">
          <div className="meta-row">
            <span className="meta-row__key">Read-only tools</span>
            <span className="meta-row__value">
              <span className="status status--ok">Allowed · audited</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Write / dangerous tools</span>
            <span className="meta-row__value">
              <span className="status status--warn">Approval required</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Tenant isolation</span>
            <span className="meta-row__value mono">enforced</span>
          </div>
        </SectionCard>

        <SectionCard label="Trust" title="Audit &amp; source traceability" tag="read-only">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            Every AI claim carries a source reference; every state change — sign-in,
            source and key changes, prompt edits, model calls — is written to an
            append-only, tenant-scoped audit log.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Audit log</span>
            <span className="meta-row__value mono">append-only · tenant-scoped</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Source references</span>
            <span className="meta-row__value mono">required on every insight</span>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
