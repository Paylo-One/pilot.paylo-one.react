/**
 * Settings — workspace identity, profile, model use, security and privacy,
 * invitations, tool access, and trust, plus admin views for privileged roles.
 * Governance: multi-tenancy-design.md (tenant/subdomain), security-and-privacy.md
 * (storage + retention), authentication-architecture.md (passkeys),
 * model-inference-architecture.md (model use), product/access-and-invitations.md
 * (invitations + access requests), audit-and-source-traceability.md (audit).
 *
 * Server component. Interactive sections (profile, your own model key, passkeys,
 * invitations) are tagged "Available". Sections that describe enforced behaviour
 * you can read but not change are tagged "Read only". Features that are not open
 * yet are tagged "Planned" and rendered as non-interactive roadmap.
 */

import {
  requireTenantContext,
  getSignedInUser,
} from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listTenantModelProviders } from "@/modules/tenant-models/server";
import {
  accessRequestService,
  type AccessRequest,
  type AccessRequestStatus,
} from "@/modules/access-requests";
import {
  betaInvitationService,
  invitationLink,
  INVITATION_ALLOWANCE,
  type TenantInvitation,
} from "@/modules/beta-invitations";
import {
  SettingsProfileForm,
  type ProfileFormValues,
} from "./settings-form";
import { PasskeysCard } from "./passkeys-card";
import { ByoModelCard } from "@/components/settings/byo-model-card";
import { InvitationsCard } from "./invitations-card";
import { SettingsNav } from "./settings-nav";
import {
  INVITATION_STATUS_LABELS,
  INVITATION_STATUS_TONE,
  type InvitationView,
} from "./invitation-types";

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

const REQUEST_STATUS_LABELS: Record<AccessRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  invited: "Invited",
};

const REQUEST_STATUS_TONE: Record<
  AccessRequestStatus,
  "info" | "ok" | "neutral"
> = {
  pending: "info",
  approved: "ok",
  declined: "neutral",
  invited: "ok",
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

  // Invitations: the signed-in user's allowance + their own invitations.
  const [allowanceRes, minesRes] = await Promise.all([
    betaInvitationService.allowance(ctx),
    betaInvitationService.listMine(ctx),
  ]);
  const allowance = allowanceRes.ok
    ? allowanceRes.value
    : { total: INVITATION_ALLOWANCE, used: 0, remaining: INVITATION_ALLOWANCE };
  const myInvitations: InvitationView[] = minesRes.ok
    ? minesRes.value.map((inv) => ({
        id: inv.id,
        email: inv.email,
        status: inv.status,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        link: invitationLink(ctx, inv.token),
      }))
    : [];

  // Admin-only: access requests + every invitation in the workspace.
  const privileged = isPrivilegedRole(ctx.role);
  let accessRequests: AccessRequest[] = [];
  let tenantInvitations: TenantInvitation[] = [];
  if (privileged) {
    const [requestsRes, tenantInvitesRes] = await Promise.all([
      accessRequestService.listForReview(ctx, 25),
      betaInvitationService.listForTenant(ctx),
    ]);
    if (requestsRes.ok) accessRequests = requestsRes.value;
    if (tenantInvitesRes.ok) tenantInvitations = tenantInvitesRes.value;
  }

  // Section rail (Admin appears only for privileged roles).
  const sections = [
    { id: "workspace", label: "Workspace" },
    { id: "intelligence", label: "Intelligence" },
    { id: "invitations", label: "Invitations" },
    { id: "security", label: "Security & privacy" },
    { id: "tools", label: "Tool access & trust" },
    ...(privileged ? [{ id: "admin", label: "Admin" }] : []),
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

        {/* ===== Invitations ============================================== */}
        <GroupHeading id="invitations">Invitations</GroupHeading>

        <SectionCard
          label="Beta invitations"
          title="Invite people to Paylo.one"
          tag="active"
        >
          <InvitationsCard allowance={allowance} invitations={myInvitations} />
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
            <span className="meta-row__value">
              <button type="button" className="btn btn--ghost btn--sm" disabled title="Coming soon">
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

        {/* ===== Admin (privileged roles only) ============================ */}
        {privileged ? (
          <>
            <GroupHeading id="admin">Admin</GroupHeading>

            <SectionCard
              label="Access requests"
              title="People asking for access"
              tag="read-only"
            >
              <p
                className="action-card__rationale"
                style={{ marginBottom: "var(--space-md)" }}
              >
                Requests submitted from the website. Review them and reach out by
                email. Approving and inviting from here is coming soon.
              </p>
              {accessRequests.length === 0 ? (
                <div className="empty">
                  <p className="empty__title">No requests yet</p>
                  <p className="empty__body">
                    When someone asks for access from the website, it will appear
                    here for review.
                  </p>
                </div>
              ) : (
                <div className="stack" style={{ gap: 0 }}>
                  {accessRequests.map((req) => (
                    <div className="meta-row" key={req.id}>
                      <span className="meta-row__key" style={{ minWidth: 0 }}>
                        <span style={{ color: "var(--colour-text-primary)" }}>
                          {req.name}
                        </span>
                        <span
                          className="mono"
                          style={{
                            display: "block",
                            fontSize: "var(--text-label)",
                            color: "var(--colour-text-tertiary)",
                          }}
                        >
                          {req.email}
                          {req.companyOrRole ? ` · ${req.companyOrRole}` : ""}
                        </span>
                        {req.reason ? (
                          <span
                            style={{
                              display: "block",
                              fontSize: "var(--text-small)",
                              color: "var(--colour-text-secondary)",
                              marginTop: "var(--space-xs)",
                            }}
                          >
                            {req.reason}
                          </span>
                        ) : null}
                      </span>
                      <span className="meta-row__value">
                        <span
                          className={`status status--${REQUEST_STATUS_TONE[req.status]}`}
                        >
                          {REQUEST_STATUS_LABELS[req.status]}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              label="Invitations"
              title="All workspace invitations"
              tag="read-only"
            >
              {tenantInvitations.length === 0 ? (
                <div className="empty">
                  <p className="empty__title">No invitations sent</p>
                  <p className="empty__body">
                    Invitations sent by anyone in this workspace will appear here.
                  </p>
                </div>
              ) : (
                <div className="stack" style={{ gap: 0 }}>
                  {tenantInvitations.map((inv) => (
                    <div className="meta-row" key={inv.id}>
                      <span className="meta-row__key" style={{ minWidth: 0 }}>
                        <span style={{ color: "var(--colour-text-primary)" }}>
                          {inv.email}
                        </span>
                        <span
                          className="mono"
                          style={{
                            display: "block",
                            fontSize: "var(--text-label)",
                            color: "var(--colour-text-tertiary)",
                          }}
                        >
                          Sent by {inv.inviterName}
                        </span>
                      </span>
                      <span className="meta-row__value">
                        <span
                          className={`status status--${INVITATION_STATUS_TONE[inv.status]}`}
                        >
                          {INVITATION_STATUS_LABELS[inv.status]}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </>
        ) : null}
        </div>
      </div>
    </main>
  );
}
