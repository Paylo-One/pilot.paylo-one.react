/**
 * Intelligence — the control surface for how Pilot reads, remembers,
 * prioritises, and acts on a workspace's information. This layout carries the
 * section header and the in-section navigation; each sub-route renders its own
 * content below the tabs.
 */

import type { ReactNode } from "react";
import { IntelligenceNav } from "./intelligence-nav";

export default function IntelligenceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Intelligence</p>
        <h1 className="page-head__title">How Pilot works for you</h1>
        <p className="page-head__lead">
          Shape how Pilot reads your sources, remembers what matters,
          prioritises your attention, and turns information into decisions and
          actions. Every change is private to your workspace, versioned, and
          safe to test before it goes live.
        </p>
      </div>

      <IntelligenceNav />

      {children}
    </main>
  );
}
