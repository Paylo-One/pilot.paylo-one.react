/**
 * Intelligence · Custom skills · detail — one skill's behaviour, versions, and
 * the prompts it is applied to. Loads the skill + the names of its linked
 * prompts; the interactive panels are client components.
 */

import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSkill } from "@/modules/custom-skills/server";
import { SkillDetail } from "@/components/skills/skill-detail";

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireTenantContext();
  const { id } = await params;

  const detail = await getSkill(ctx, id);
  if (!detail.ok) notFound();
  const skill = detail.value;

  let linkedPrompts: Array<{ id: string; name: string }> = [];
  if (skill.linkedPromptIds.length > 0) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("tenant_prompts")
      .select("id, name")
      .in("id", skill.linkedPromptIds as string[]);
    linkedPrompts = (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
    }));
  }

  return (
    <SkillDetail
      skill={skill}
      linkedPrompts={linkedPrompts}
      canEdit={isPrivilegedRole(ctx.role)}
    />
  );
}
