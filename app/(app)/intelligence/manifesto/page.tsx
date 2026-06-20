/**
 * Intelligence · Manager manifesto — the guiding principles that shape every
 * judgement Pilot makes. Lazily seeds the default manifesto on first read.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared";
import { getManifesto } from "@/modules/manager-manifesto/server";
import { ManifestoEditor } from "./manifesto-editor";

export default async function ManifestoPage() {
  const ctx = await requireTenantContext();
  const manifesto = await getManifesto(ctx);

  if (!manifesto.ok) {
    return (
      <div className="alert alert--warn">
        <div>
          <p className="alert__body">
            The manifesto could not be loaded: {manifesto.error.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ManifestoEditor
      manifesto={manifesto.value}
      canEdit={isPrivilegedRole(ctx.role)}
    />
  );
}
