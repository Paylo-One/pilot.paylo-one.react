/**
 * Settings — workspace + profile. multi-tenancy-design.md (user_profiles).
 *
 * Server component: shows the resolved workspace (tenant slug), the signed-in
 * user's email and role, and an editable profile form (display name, timezone,
 * briefing time) persisted via the USER server client (RLS: own row only).
 * Sign-out lives in the app shell navigation — not duplicated here.
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

const metaRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-md)",
  padding: "var(--space-sm) 0",
  borderBottom: "1px solid var(--colour-border)",
};

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
    // Postgres `time` comes back as e.g. "08:30:00"; trim to HH:MM for the input.
    briefingTime: (profile?.briefing_time as string | null)?.slice(0, 5) ?? "",
  };

  return (
    <main className="app-main">
      <p className="eyebrow">Settings</p>
      <h1 style={{ fontSize: "var(--text-h2)", margin: "8px 0 16px" }}>
        Workspace settings
      </h1>

      <div
        className="panel"
        style={{ marginBottom: "var(--space-lg)", maxWidth: "520px" }}
      >
        <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
          Workspace
        </p>
        <div style={metaRowStyle}>
          <span style={{ color: "var(--colour-text-secondary)" }}>
            Subdomain
          </span>
          <span className="mono">{ctx.tenantSlug}.paylo.one</span>
        </div>
        <div style={metaRowStyle}>
          <span style={{ color: "var(--colour-text-secondary)" }}>
            Signed in as
          </span>
          <span className="mono">{user?.email ?? "\u2014"}</span>
        </div>
        <div style={{ ...metaRowStyle, borderBottom: "none" }}>
          <span style={{ color: "var(--colour-text-secondary)" }}>Role</span>
          <span className="badge">{ctx.role}</span>
        </div>
      </div>

      <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
        Your profile
      </p>
      <SettingsProfileForm values={values} />

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        To sign out, use the control in the navigation panel.
      </p>
    </main>
  );
}
