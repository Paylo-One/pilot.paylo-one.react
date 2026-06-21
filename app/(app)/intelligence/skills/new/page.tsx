/** Intelligence · Custom skills · New — create a custom skill (owners/admins). */

import { redirect } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared";
import { SkillCreate } from "./skill-create";

export default async function NewSkillPage() {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) redirect("/intelligence/skills");
  return <SkillCreate />;
}
