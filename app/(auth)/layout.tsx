/**
 * app/(auth)/layout.tsx
 *
 * Layout for the authentication surfaces (sign-in, invite acceptance,
 * registration, onboarding), served on the apex / neutral host. Authentication
 * establishes WHO the user is; the tenant is resolved separately, server-side,
 * from the request host (authentication-architecture.md §8). No session is
 * established here.
 *
 * Two panes form the "front door":
 *   - a calm, always-dark command-layer panel that carries the brand and the
 *     product promise (hidden below the tablet breakpoint so the form leads on
 *     small screens);
 *   - the authentication panel itself, centred, with a local brand lockup that
 *     only appears when the aside is hidden.
 */

import { BrandMark } from "@/components/brand-mark";
import { PayloWordmark } from "@/components/paylo-wordmark";

const TRUST_CUES = [
  {
    title: "Passkey sign-in",
    body: "No passwords to phish or forget. Your device is the key.",
    icon: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
  },
  {
    title: "Invitation only",
    body: "Access is granted deliberately — never sold, scraped, or guessed.",
    icon: (
      <>
        <path d="M20 8v6a2 2 0 0 1-2 2H6l-4 4V6a2 2 0 0 1 2-2h9" />
        <path d="m16 3 2 2 4-4" />
      </>
    ),
  },
  {
    title: "Private by design",
    body: "Your workspace is yours. We only show what your account may see.",
    icon: (
      <>
        <path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
];

function BrandLockup() {
  return (
    <div className="auth__brand" style={{ color: "var(--colour-text-primary)" }}>
      <BrandMark size={28} />
      <div className="brand__wordmark">
        <PayloWordmark size={18} />
        <span className="brand__inst" style={{ color: "var(--colour-text-tertiary)" }}>
          Pilot
        </span>
      </div>
    </div>
  );
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="auth-aside__brand">
          <BrandMark size={30} />
          <div className="brand__wordmark">
            <PayloWordmark size={19} />
            <span className="brand__inst">Pilot</span>
          </div>
        </div>

        <div className="auth-aside__lede">
          <p className="auth-aside__statement">
            A private operating layer for your working life.
          </p>
          <p className="auth-aside__sub">
            Your briefings, decisions, people, and daily actions — held in one
            calm, secure place that only you can open.
          </p>

          <ul className="auth-trust">
            {TRUST_CUES.map((cue) => (
              <li key={cue.title} className="auth-trust__item">
                <svg
                  className="auth-trust__icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {cue.icon}
                </svg>
                <span>
                  <span className="auth-trust__title">{cue.title}</span>
                  <span className="auth-trust__body">{cue.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-aside__foot">Encrypted in transit · Isolated per workspace</p>
      </aside>

      <main className="auth__main" style={{ color: "var(--colour-text-primary)" }}>
        <div className="auth__panel">
          <div className="auth__brand-local">
            <BrandLockup />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
