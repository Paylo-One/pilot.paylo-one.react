"use server";

/**
 * Server action for the public Request access form. There is no session or
 * tenant here: the visitor is not signed in. The action validates and stores
 * the request through the access-requests module (service-role write) and
 * returns a plain success/error state for the form to render.
 */

import { headers } from "next/headers";
import { accessRequestService } from "@/modules/access-requests";
import type { RequestAccessState } from "./types";

export async function requestAccessAction(
  _prev: RequestAccessState,
  formData: FormData,
): Promise<RequestAccessState> {
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const companyOrRole = String(formData.get("companyOrRole") ?? "");
  const reason = String(formData.get("reason") ?? "");

  const userAgent = (await headers()).get("user-agent") ?? undefined;

  const result = await accessRequestService.create({
    name,
    email,
    companyOrRole,
    reason,
    userAgent,
  });

  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }
  return { status: "ok", message: null };
}
