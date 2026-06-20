/**
 * Intelligence · Custom skills — the library of reusable instruction sets that
 * compose into prompts. Lazily seeds the default catalogue on first read.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared";
import { listSkills } from "@/modules/custom-skills/server";
import { SkillsBrowser } from "./skills-browser";

export default async function SkillsPage() {
  const ctx = await requireTenantContext();
  const skills = await listSkills(ctx);

  if (!skills.ok) {
    return (
      <div className="alert alert--warn">
        <div>
          <p className="alert__body">
            Skills could not be loaded: {skills.error.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <SkillsBrowser skills={skills.value} canEdit={isPrivilegedRole(ctx.role)} />
  );
}
