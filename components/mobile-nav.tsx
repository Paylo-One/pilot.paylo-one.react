"use client";

/**
 * components/mobile-nav.tsx
 *
 * Mobile navigation for the workspace shell. Below the 960px breakpoint the
 * dark command sidebar is hidden and this takes over: a single burger trigger
 * in the topbar opens a slide-out drawer carrying the same command layer —
 * brand, tenant context, primary nav, and the operator footer — so the page
 * itself stays uncluttered.
 *
 * Drawer behaviour: closes on backdrop tap, Escape, and route change; locks
 * body scroll while open; trigger and panel stay wired with aria-expanded /
 * dialog semantics. Desktop (≥960px) never sees any of this — CSS hides the
 * trigger and the drawer entirely.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand-mark";
import { PayloWordmark } from "@/components/paylo-wordmark";
import { WorkspaceNav } from "@/components/workspace-nav";

export function MobileNav({
  tenantSlug,
  email,
}: {
  tenantSlug: string;
  email: string | null;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const tCommon = useTranslations("common");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="mobile-nav__trigger"
        aria-label={open ? t("mobile.closeMenu") : t("mobile.openMenu")}
        aria-expanded={open}
        aria-controls="mobile-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <div
        id="mobile-drawer"
        className={`drawer${open ? " drawer--open" : ""}`}
        aria-hidden={!open}
      >
        <div className="drawer__backdrop" onClick={() => setOpen(false)} />
        <div
          className="drawer__panel"
          role="dialog"
          aria-modal="true"
          aria-label={t("mobile.label")}
        >
          <div className="drawer__head">
            <div className="brand">
              <BrandMark size={24} className="brand__mark" />
              <div className="brand__wordmark">
                <PayloWordmark size={16} />
                <span className="brand__inst">Pilot</span>
              </div>
            </div>
            <button
              type="button"
              className="drawer__close"
              aria-label={t("mobile.closeMenu")}
              onClick={() => setOpen(false)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="tenant-chip" title={tShell("workspace.tenantTitle")}>
            <span className="tenant-chip__dot" aria-hidden="true" />
            <div className="tenant-chip__body">
              <div className="tenant-chip__label">{tShell("workspace.label")}</div>
              <div className="tenant-chip__value">{tenantSlug}.paylo.one</div>
            </div>
          </div>

          <WorkspaceNav onNavigate={() => setOpen(false)} />

          <div className="nav__footer">
            <span className="nav__operator" title={email ?? undefined}>
              {email ?? tShell("operator")}
            </span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="nav__signout">
                <svg
                  className="nav__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5M21 12H9" />
                </svg>
                <span>{tCommon("actions.signOut")}</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
