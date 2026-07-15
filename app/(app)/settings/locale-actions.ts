"use server";

/**
 * Locale preference server actions (ADR-052).
 *
 * `setLocaleAction` is the single write path for the language selector. It:
 *   1. validates the requested locale against the supported list;
 *   2. sets the durable `NEXT_LOCALE` cookie (so the choice applies immediately
 *      and to signed-out surfaces on this device);
 *   3. persists it to `user_profiles.locale` when a user is signed in, so the
 *      preference follows them across sessions and devices (RLS guarantees a
 *      user can only write their own row).
 *
 * The cookie is a mirror of the durable DB preference; on the next app load
 * `app/(app)/layout.tsx` re-seeds the cookie from the DB, so a stale cookie on
 * a new device is corrected to the user's stored choice.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, isLocale, type Locale } from "@/i18n/config";
import { localeCookieOptions } from "@/lib/i18n/locale-cookie";
import {
  getSignedInUser,
  resolveTenantContext,
} from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { auditService } from "@/modules/audit";

export interface SetLocaleResult {
  readonly ok: boolean;
  readonly locale: Locale | null;
}

export async function setLocaleAction(requested: string): Promise<SetLocaleResult> {
  if (!isLocale(requested)) {
    return { ok: false, locale: null };
  }
  const locale: Locale = requested;

  // 1. Always set the cookie — immediate, and covers signed-out surfaces.
  //    Apex-scoped so it is carried across every tenant subdomain.
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, localeCookieOptions());

  // 2. Persist to the profile when signed in (durable, cross-device).
  const user = await getSignedInUser();
  if (user) {
    const supabase = await createSupabaseServerClient();
    await supabase
      .from("user_profiles")
      .upsert({ user_id: user.userId, locale }, { onConflict: "user_id" });

    // Best-effort audit; never let audit failure block a preference change.
    const resolution = await resolveTenantContext();
    if (resolution.kind === "ok") {
      await auditService.record(resolution.context, {
        action: "profile.locale.updated",
        metadata: { locale },
      });
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, locale };
}
