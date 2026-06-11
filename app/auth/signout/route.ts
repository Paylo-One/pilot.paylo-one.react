/**
 * /auth/signout — ends the Supabase session and returns to sign-in. POST only
 * (state-changing). Cookies are cleared via @supabase/ssr.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appHostBaseUrl } from "@/lib/config";

export async function POST(_request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${appHostBaseUrl()}/sign-in`, { status: 303 });
}
