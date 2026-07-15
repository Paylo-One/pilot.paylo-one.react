"use client";

/**
 * A consistent, accessible language selector (ADR-052).
 *
 * Deliberately a native <select>: it is keyboard- and screen-reader-accessible
 * for free, needs no portal/listbox JS, and renders each language as its own
 * endonym (never a flag — flags denote countries, not languages). Choosing a
 * language calls `setLocaleAction`, which sets the durable cookie and persists
 * `user_profiles.locale` when signed in; a router refresh re-renders the tree
 * with the new messages (the whole app is server-rendered from the cookie).
 *
 * Works on authenticated and signed-out surfaces alike: signed out, the action
 * still sets the cookie so the choice applies immediately on this device.
 */

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { locales, localeConfig, isLocale } from "@/i18n/config";
import { setLocaleAction } from "@/app/(app)/settings/locale-actions";

export function LanguageSelector({
  id = "language-selector",
  className = "input select",
}: {
  id?: string;
  className?: string;
}) {
  const active = useLocale();
  const t = useTranslations("shared.language");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isLocale(next) || next === active) return;
    startTransition(async () => {
      await setLocaleAction(next);
      // Re-fetch server components so every string re-renders in the new locale.
      router.refresh();
    });
  }

  return (
    <select
      id={id}
      name="locale"
      className={className}
      value={isLocale(active) ? active : "en"}
      onChange={onChange}
      disabled={pending}
      aria-label={t("change")}
    >
      {locales.map((loc) => (
        <option key={loc} value={loc}>
          {localeConfig[loc].label}
        </option>
      ))}
    </select>
  );
}
