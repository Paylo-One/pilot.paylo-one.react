/**
 * Prompt detail moved into the Intelligence control surface. Redirect old links
 * to the new home.
 */

import { redirect } from "next/navigation";

export default async function PromptDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/intelligence/prompts/${id}`);
}
