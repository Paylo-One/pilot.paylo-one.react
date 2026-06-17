"use client";

import { useState, startTransition } from "react";
import { BrandMark } from "@/components/brand-mark";
import { completeOnboardingAction } from "@/app/(app)/onboarding-actions";
import type { SourceSystem } from "@/modules/shared";

interface Profile {
  display_name: string | null;
  timezone: string;
  briefing_time: string | null;
}

export function OnboardingWizard({ profile }: { profile: Profile | null }) {
  const [step, setStep] = useState<number>(1);
  const [timezone, setTimezone] = useState<string>(
    profile?.timezone ||
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "UTC"
  );
  const [briefingTime, setBriefingTime] = useState<string>(
    (profile?.briefing_time as string | null)?.slice(0, 5) || "08:00"
  );
  const [syncSources, setSyncSources] = useState<SourceSystem[]>(["github"]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSource = (src: SourceSystem) => {
    setSyncSources((prev) =>
      prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]
    );
  };

  const handleNext = () => setStep((s) => s + 1);
  const handlePrev = () => setStep((s) => s - 1);

  const handleComplete = async () => {
    setIsSubmitting(true);
    setError(null);
    startTransition(async () => {
      const res = await completeOnboardingAction({
        timezone,
        briefingTime,
        syncSources,
      });
      if (res.ok) {
        // revalidatePath on server will trigger root refresh and remove layout gate.
      } else {
        setIsSubmitting(false);
        setError(res.error || "Failed to finalize onboarding. Please try again.");
      }
    });
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal glass">
        {/* Progress header */}
        <div className="onboarding-progress">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`onboarding-progress__dot ${
                step >= i ? "onboarding-progress__dot--active" : ""
              }`}
            />
          ))}
        </div>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="onboarding-step fade-in">
            <div className="onboarding-step__hero">
              <BrandMark size={48} className="onboarding-step__logo" />
              <h1 className="onboarding-step__title">Welcome to Paylo.one</h1>
              <p className="onboarding-step__subtitle mono">Management OS for quiet leaders</p>
            </div>
            <div className="onboarding-step__body">
              <p>
                Paylo.one is designed to return clarity and focus to your day. It runs inside an
                isolated, high-security multi-tenant architecture, ensuring every signal and reference remains strictly private to your workspace.
              </p>
              <p>
                By replacing noisy notifications with a single, correlation-derived Daily Memo,
                Paylo.one empowers you to make high-context decisions with calm confidence.
              </p>
            </div>
            <div className="onboarding-step__actions">
              <button type="button" className="btn btn--primary" onClick={handleNext}>
                Get Started
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Briefing Rhythm */}
        {step === 2 && (
          <div className="onboarding-step fade-in">
            <h2 className="onboarding-step__heading">Set Your Daily Rhythm</h2>
            <p className="onboarding-step__description">
              Choose when your Daily Memo should be prepared. We recommend early morning so you are briefed before starting work.
            </p>
            <div className="onboarding-form">
              <div className="form-group">
                <label className="form-label mono">TIMEZONE</label>
                <input
                  type="text"
                  className="form-input"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="e.g. Europe/London"
                />
                <span className="form-help">Automatically detected from your browser</span>
              </div>
              <div className="form-group">
                <label className="form-label mono">BRIEFING TIME</label>
                <input
                  type="time"
                  className="form-input"
                  value={briefingTime}
                  onChange={(e) => setBriefingTime(e.target.value)}
                />
                <span className="form-help">The Daily Memo will be ready at this hour</span>
              </div>
            </div>
            <div className="onboarding-step__actions">
              <button type="button" className="btn btn--ghost" onClick={handlePrev}>
                Back
              </button>
              <button type="button" className="btn btn--primary" onClick={handleNext}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Connect Feeds */}
        {step === 3 && (
          <div className="onboarding-step fade-in">
            <h2 className="onboarding-step__heading">Connect Your Feeds</h2>
            <p className="onboarding-step__description">
              Enable auto-refresh for sources you plan to monitor. Paylo.one will securely sync feeds in the background to inform your briefing.
            </p>
            <div className="onboarding-sources">
              {[
                { id: "github", label: "GitHub", desc: "Monitor repositories & team actions" },
                { id: "calendar", label: "Google Calendar", desc: "Sync executive schedule & agendas" },
                { id: "slack", label: "Slack", desc: "Correlate chat channels into clear signals" },
                { id: "discord", label: "Discord", desc: "Identify focus items from server discussions" },
              ].map((src) => {
                const isSelected = syncSources.includes(src.id as SourceSystem);
                return (
                  <div
                    key={src.id}
                    className={`onboarding-source-card ${isSelected ? "onboarding-source-card--active" : ""}`}
                    onClick={() => toggleSource(src.id as SourceSystem)}
                  >
                    <div className="onboarding-source-card__body">
                      <p className="onboarding-source-card__title">{src.label}</p>
                      <p className="onboarding-source-card__desc">{src.desc}</p>
                    </div>
                    <div className="onboarding-source-card__control">
                      <span className={`toggle-switch ${isSelected ? "toggle-switch--active" : ""}`} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="onboarding-step__actions">
              <button type="button" className="btn btn--ghost" onClick={handlePrev}>
                Back
              </button>
              <button type="button" className="btn btn--primary" onClick={handleNext}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Commitments Philosophy */}
        {step === 4 && (
          <div className="onboarding-step fade-in">
            <h2 className="onboarding-step__heading">The Commitments Philosophy</h2>
            <p className="onboarding-step__description">
              How Paylo.one keeps you accountable and focused.
            </p>
            <div className="onboarding-philosophy">
              <div className="onboarding-philosophy__item">
                <div className="onboarding-philosophy__icon">🔍</div>
                <div className="onboarding-philosophy__text">
                  <h3>Signal Extraction</h3>
                  <p>Fragmented messages and threads are evaluated for commitments, actions, and key decisions automatically.</p>
                </div>
              </div>
              <div className="onboarding-philosophy__item">
                <div className="onboarding-philosophy__icon">📊</div>
                <div className="onboarding-philosophy__text">
                  <h3>Relationship Awareness</h3>
                  <p>Actions are mapped back to people inside your directory, ranked by the importance of those relationships.</p>
                </div>
              </div>
              <div className="onboarding-philosophy__item">
                <div className="onboarding-philosophy__icon">🧘</div>
                <div className="onboarding-philosophy__text">
                  <h3>Zero Dashboard Fatigue</h3>
                  <p>No infinite queues or inbox noise. Just what matters, when it matters, with verified confidence scores.</p>
                </div>
              </div>
            </div>
            <div className="onboarding-step__actions">
              <button type="button" className="btn btn--ghost" onClick={handlePrev}>
                Back
              </button>
              <button type="button" className="btn btn--primary" onClick={handleNext}>
                Got it
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Confirm & Persist */}
        {step === 5 && (
          <div className="onboarding-step fade-in">
            <h2 className="onboarding-step__heading">Ready to Initialize</h2>
            <p className="onboarding-step__description">
              Confirm your quiet management settings to activate your private workspace.
            </p>
            <div className="onboarding-review glass">
              <div className="onboarding-review__row">
                <span className="mono">TIMEZONE</span>
                <span>{timezone}</span>
              </div>
              <div className="onboarding-review__row">
                <span className="mono">BRIEFING HOUR</span>
                <span>{briefingTime} Daily</span>
              </div>
              <div className="onboarding-review__row">
                <span className="mono">AUTO-REFRESH SOURCES</span>
                <span>
                  {syncSources.length === 0
                    ? "None selected"
                    : syncSources.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ")}
                </span>
              </div>
            </div>

            {error && <div className="alert alert--warn" style={{ marginTop: "var(--space-md)" }}>{error}</div>}

            <div className="onboarding-step__actions">
              <button type="button" className="btn btn--ghost" onClick={handlePrev} disabled={isSubmitting}>
                Back
              </button>
              <button type="button" className="btn btn--primary" onClick={handleComplete} disabled={isSubmitting}>
                {isSubmitting ? "Initializing OS..." : "Initialize Workspace"}
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        /* --- Onboarding Glassmorphism Modal Styles --- */
        .onboarding-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(10, 12, 15, 0.88);
          backdrop-filter: blur(12px);
          padding: var(--space-md);
        }

        .onboarding-modal {
          position: relative;
          width: 100%;
          max-width: 580px;
          border-radius: var(--radius-lg);
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(21, 24, 30, 0.7);
          box-shadow: var(--shadow-pop);
          padding: var(--space-xl);
          display: flex;
          flex-direction: column;
          gap: var(--space-lg);
        }

        .onboarding-progress {
          display: flex;
          gap: var(--space-sm);
          justify-content: center;
          margin-bottom: var(--space-sm);
        }

        .onboarding-progress__dot {
          width: 24px;
          height: 3px;
          border-radius: var(--radius-pill);
          background: var(--colour-border);
          opacity: 0.3;
          transition: background var(--speed) var(--ease-standard), opacity var(--speed) var(--ease-standard);
        }

        .onboarding-progress__dot--active {
          background: var(--colour-accent);
          opacity: 1;
        }

        .onboarding-step {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
        }

        .onboarding-step__hero {
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-md);
        }

        .onboarding-step__logo {
          color: var(--colour-accent);
          filter: drop-shadow(0 0 16px rgba(42, 167, 181, 0.2));
        }

        .onboarding-step__title {
          font-size: var(--text-h1);
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--colour-text-primary);
        }

        .onboarding-step__subtitle {
          font-size: var(--text-small);
          color: var(--colour-accent);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .onboarding-step__heading {
          font-size: var(--text-h2);
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--colour-text-primary);
        }

        .onboarding-step__description {
          font-size: var(--text-body);
          color: var(--colour-text-secondary);
          line-height: var(--leading-snug);
        }

        .onboarding-step__body {
          font-size: var(--text-body);
          color: var(--colour-text-secondary);
          line-height: var(--leading-normal);
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
        }

        .onboarding-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
          margin-top: var(--space-sm);
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-label {
          font-size: var(--text-label);
          color: var(--colour-text-muted);
          letter-spacing: var(--tracking-label);
        }

        .form-input {
          padding: 10px 14px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--colour-border);
          background: rgba(255, 255, 255, 0.02);
          color: var(--colour-text-primary);
          font-family: inherit;
          font-size: var(--text-body);
          transition: border-color var(--speed) var(--ease-standard);
        }

        .form-input:focus {
          outline: none;
          border-color: var(--colour-accent);
          background: rgba(255, 255, 255, 0.04);
        }

        .form-help {
          font-size: var(--text-label);
          color: var(--colour-text-muted);
        }

        .onboarding-sources {
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
          margin-top: var(--space-xs);
        }

        .onboarding-source-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-sm) var(--space-md);
          border-radius: var(--radius-md);
          border: 1px solid var(--colour-border);
          background: rgba(255, 255, 255, 0.02);
          cursor: pointer;
          transition: border-color var(--speed) var(--ease-standard), background var(--speed) var(--ease-standard);
        }

        .onboarding-source-card:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: var(--colour-border-strong);
        }

        .onboarding-source-card--active {
          border-color: var(--colour-accent);
          background: rgba(42, 167, 181, 0.04);
        }

        .onboarding-source-card__title {
          font-weight: 600;
          color: var(--colour-text-primary);
          margin: 0;
        }

        .onboarding-source-card__desc {
          font-size: var(--text-small);
          color: var(--colour-text-secondary);
          margin: 2px 0 0 0;
        }

        .toggle-switch {
          position: relative;
          width: 36px;
          height: 18px;
          background: var(--colour-border);
          border-radius: var(--radius-pill);
          transition: background var(--speed) var(--ease-standard);
        }

        .toggle-switch::after {
          content: "";
          position: absolute;
          top: 2px;
          left: 2px;
          width: 14px;
          height: 14px;
          background: var(--colour-surface-elevated);
          border-radius: var(--radius-pill);
          transition: transform var(--speed) var(--ease-standard);
        }

        .toggle-switch--active {
          background: var(--colour-accent);
        }

        .toggle-switch--active::after {
          transform: translateX(18px);
        }

        .onboarding-philosophy {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
          margin-top: var(--space-xs);
        }

        .onboarding-philosophy__item {
          display: flex;
          gap: var(--space-md);
          align-items: flex-start;
        }

        .onboarding-philosophy__icon {
          font-size: 24px;
          line-height: 1;
          padding-top: 2px;
        }

        .onboarding-philosophy__text h3 {
          font-size: var(--text-body);
          font-weight: 600;
          color: var(--colour-text-primary);
          margin: 0;
        }

        .onboarding-philosophy__text p {
          font-size: var(--text-small);
          color: var(--colour-text-secondary);
          margin: 4px 0 0 0;
          line-height: var(--leading-snug);
        }

        .onboarding-review {
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
          padding: var(--space-md);
          border-radius: var(--radius-md);
          border: 1px solid var(--colour-border);
          background: rgba(255, 255, 255, 0.01);
          margin-top: var(--space-xs);
        }

        .onboarding-review__row {
          display: flex;
          justify-content: space-between;
          font-size: var(--text-small);
        }

        .onboarding-review__row span:first-child {
          color: var(--colour-text-muted);
          letter-spacing: var(--tracking-label);
        }

        .onboarding-review__row span:last-child {
          color: var(--colour-text-primary);
          font-weight: 500;
        }

        .onboarding-step__actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--space-md);
          margin-top: var(--space-lg);
          border-top: 1px solid var(--colour-border);
          padding-top: var(--space-md);
        }

        .fade-in {
          animation: fadeIn 350ms var(--ease-standard) forwards;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
