/**
 * The prompt library moved into the Intelligence control surface. This route
 * now redirects to its new home so old links keep working.
 */

import { redirect } from "next/navigation";

export default function PromptsPage() {
  redirect("/intelligence/prompts");
}
