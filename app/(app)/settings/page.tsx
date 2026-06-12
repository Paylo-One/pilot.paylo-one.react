/**
 * Settings — workspace, profile, privacy, security, and routing controls.
 * Governance: multi-tenancy-design.md (tenant/subdomain), security-and-privacy.md
 * (storage + retention), authentication-architecture.md (passkeys + recovery),
 * model-inference-architecture.md (model routing), mcp-tool-architecture.md
 * (tool permissions), audit-and-source-traceability.md (audit).
 *
 * Server component: the workspace identity and profile form are wired (RLS: own
 * row). The remaining sections are scaffolded read-only views of the designed
 * controls — clearly marked, with no persistence in this build.
 */

import {
  requireTenantContext,
  getSignedInUser,
} from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SettingsProfileForm,
  type ProfileFormValues,
} from "./settings-form";
import { PasskeysCard } from "./passkeys-card";

function SectionCard({
  label,
  title,
  scaffolded,
  children,
}: {
  label: string;
  title: string;
  scaffolded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="card" style={{ maxWidth: "640px" }}>
      <div className="card-head">
        <div>
          <p className="eyebrow">{label}</p>
          <h2 className="card__title">{title}</h2>
        </div>
        {scaffolded ? <span className="badge">scaffold</span> : null}
      </div>
      {children}
    </section>
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
          Your workspace identity, privacy posture, security, and how the system
          routes intelligence. You can see, export, and delete your data; you
          stay in command.
        </p>
      </div>

      <div className="stack" style={{ gap: "var(--space-lg)" }}>
        {/* --- Tenant profile (wired identity) --------------------------- */}
        <SectionCard label="Tenant" title="Workspace">
          <div className="meta-row">
            <span className="meta-row__key">Subdomain</span>
            <span className="meta-row__value mono">
              {ctx.tenantSlug}.paylo.one
            </span>
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

        {/* --- Profile (wired) ------------------------------------------- */}
        <div>
          <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
            Your profile
          </p>
          <SettingsProfileForm values={values} />
        </div>

        {/* --- Storage & retention --------------------------------------- */}
        <SectionCard label="Privacy" title="Storage &amp; retention" scaffolded>
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
            <span className="meta-row__key">Voice-note audio</span>
            <span className="meta-row__value mono">keep transcript · purge audio</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Export &amp; delete</span>
            <span className="meta-row__value">
              <button type="button" className="btn btn--ghost" disabled title="Designed — not wired in this scaffold">
                Request export
              </button>
            </span>
          </div>
        </SectionCard>

        {/* --- Passkey authentication ------------------------------------ */}
        <SectionCard label="Security" title="Passkey authentication">
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            One passkey works across every &lt;slug&gt;.paylo.one workspace (RP
            ID = the registrable domain). Enrol at least two — on separate
            devices — so losing one is a non-event.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Sign-in methods</span>
            <span className="meta-row__value">
              <span className="badge badge--plain">passkey · magic link fallback</span>
            </span>
          </div>
          <PasskeysCard />
        </SectionCard>

        {/* --- Model routing --------------------------------------------- */}
        <SectionCard label="Intelligence" title="Model routing" scaffolded>
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            Tasks declare a policy, not a model. Sensitive content gates which
            providers may receive it. Entitlement is deny-by-default by plan tier.
          </p>
          <div className="meta-row">
            <span className="meta-row__key">Plan tier</span>
            <span className="meta-row__value">
              <span className="badge badge--plain">founding</span>
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Routing policy</span>
            <span className="meta-row__value mono">quality-first · fallback</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Sensitive content</span>
            <span className="meta-row__value mono">prefer private runtime</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Monthly token budget</span>
            <span className="meta-row__value mono">— / —</span>
          </div>
        </SectionCard>

        {/* --- MCP permissions ------------------------------------------- */}
        <SectionCard label="Tenant Tool Layer" title="MCP permissions" scaffolded>
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

        {/* --- Audit ----------------------------------------------------- */}
        <SectionCard label="Trust" title="Audit &amp; source traceability" scaffolded>
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
            Every AI claim carries a source reference; every state change is
            written to an append-only, tenant-scoped audit log.
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

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        Workspace identity and your profile are wired (your row only, via RLS).
        The privacy, security, routing, MCP, and audit sections above present the
        designed controls; they are not yet persisted in this build. Sign out
        from the navigation panel.
      </p>
    </main>
  );
}
