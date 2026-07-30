/**
 * /api/notifications/unsubscribe — one-click stop for the daily briefing email.
 *
 * The link in every briefing carries the profile's unsubscribe_token, a
 * capability: presenting it is proof of receiving the email, so no session is
 * required (the operator may be reading on a device where they are not signed
 * in). GET serves the human click; POST serves RFC 8058 one-click
 * (List-Unsubscribe-Post). Both only ever flip daily_briefing_email to false
 * for the single profile holding the token.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function unsubscribe(token: string | null): Promise<boolean> {
  if (!token || !UUID_RE.test(token)) return false;
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("user_profiles")
    .update({ daily_briefing_email: false })
    .eq("unsubscribe_token", token)
    .select("user_id");
  if (error) return false;
  return (data ?? []).length > 0;
}

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Pilot</title>
</head>
<body style="margin:0;background:#f4f5f7;font-family:'IBM Plex Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16181d;">
  <main style="max-width:480px;margin:15vh auto 0;padding:32px;background:#ffffff;border:1px solid #e3e5ea;border-radius:8px;">
    <p style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#157a86;font-weight:600;">Pilot</p>
    <h1 style="margin:8px 0 0;font-size:20px;font-weight:600;">${title}</h1>
    <p style="margin:12px 0 0;color:#565d68;font-size:14px;line-height:1.6;">${body}</p>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  const done = await unsubscribe(token);
  if (!done) {
    return page(
      "That link has expired",
      "The unsubscribe link is no longer valid. You can turn the daily briefing email off in Settings inside Pilot.",
    );
  }
  return page(
    "Daily briefing email stopped",
    "You will not receive further briefing emails. You can turn them back on any time in Settings inside Pilot.",
  );
}

/** RFC 8058 one-click unsubscribe (mail clients POST with no body semantics). */
export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  const done = await unsubscribe(token);
  return new Response(null, { status: done ? 200 : 404 });
}
