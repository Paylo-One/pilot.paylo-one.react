"use server";

/**
 * Server Actions for the Manager Manifesto (/intelligence/manifesto).
 *
 * The manifesto is prepended to the system instruction of every governed AI
 * call, so editing it changes Pilot's behaviour everywhere. Mutations are
 * therefore gated to owners and admins, routed through the manager-manifesto
 * server module (secret client, append-only + single-active), and audited.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared";
import { auditService } from "@/modules/audit";
import {
  activateManifestoVersion,
  createManifestoVersion,
  getManifestoVersion,
} from "@/modules/manager-manifesto/server";

interface ActionResponse {
  readonly ok: boolean;
  readonly error: string | null;
}

function failure(error: string): ActionResponse {
  return { ok: false, error };
}

const ADMIN_ONLY = "Only workspace owners and admins can change the manifesto.";

function revalidateManifesto(): void {
  revalidatePath("/intelligence/manifesto");
  revalidatePath("/intelligence");
}

export async function createManifestoVersionAction(input: {
  manifestoId: string;
  body: string;
  principles?: string[];
  changeNote?: string;
}): Promise<ActionResponse & { versionId?: string; versionNumber?: number }> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.manifestoId) return failure("Missing manifesto id.");
  if (!input.body?.trim()) return failure("The manifesto cannot be empty.");

  const result = await createManifestoVersion(ctx, {
    manifestoId: input.manifestoId,
    body: input.body,
    principles: input.principles,
    changeNote: input.changeNote?.trim() || undefined,
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "manifesto.version.created",
    target: input.manifestoId,
    metadata: {
      versionId: result.value.versionId,
      versionNumber: result.value.versionNumber,
    },
  });
  revalidateManifesto();
  return { ok: true, error: null, ...result.value };
}

export async function activateManifestoVersionAction(input: {
  versionId: string;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.versionId) return failure("Missing version id.");

  const version = await getManifestoVersion(ctx, input.versionId);
  if (!version.ok) return failure(version.error.message);

  const result = await activateManifestoVersion(ctx, input.versionId);
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "manifesto.version.activated",
    target: version.value.manifestoId,
    metadata: {
      versionId: input.versionId,
      versionNumber: version.value.versionNumber,
    },
  });
  revalidateManifesto();
  return { ok: true, error: null };
}

/** Restore = append a new draft copying an earlier version's body. */
export async function restoreManifestoVersionAction(input: {
  versionId: string;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.versionId) return failure("Missing version id.");

  const version = await getManifestoVersion(ctx, input.versionId);
  if (!version.ok) return failure(version.error.message);
  const v = version.value;

  const result = await createManifestoVersion(ctx, {
    manifestoId: v.manifestoId,
    body: v.body,
    principles: [...v.principles],
    changeNote: `Restored from version ${v.versionNumber}.`,
    restoredFromVersionId: v.id,
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "manifesto.version.restored",
    target: v.manifestoId,
    metadata: {
      versionId: result.value.versionId,
      versionNumber: result.value.versionNumber,
      restoredFromVersionNumber: v.versionNumber,
    },
  });
  revalidateManifesto();
  return { ok: true, error: null };
}
