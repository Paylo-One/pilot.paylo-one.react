"use client";

import { startTransition, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FiArrowLeft,
  FiArrowRight,
  FiBriefcase,
  FiCalendar,
  FiCheck,
  FiClock,
  FiFileText,
  FiFlag,
  FiMessageCircle,
  FiRefreshCcw,
  FiTarget,
  FiUsers,
  FiX,
} from "react-icons/fi";
import type { IconType } from "react-icons";
import { completeOnboardingAction } from "@/app/(app)/onboarding-actions";
import { BrandMark } from "@/components/brand-mark";
import { SourceIcon } from "@/components/sources/source-icon";
import type { SourceSystem } from "@/modules/shared";

interface Profile {
  display_name: string | null;
  timezone: string;
  briefing_time: string | null;
}

type StepId = "welcome" | "rhythm" | "sources" | "focus" | "ready";
type RhythmId = "morning" | "afternoon" | "end_of_day" | "custom";
type SourceStatus = "available" | "recommended" | "needs_setup" | "planned";
type FocusId =
  | "updates"
  | "actions"
  | "decisions"
  | "people"
  | "meetings"
  | "documents";

const STEPS: readonly { id: StepId; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "rhythm", label: "Rhythm" },
  { id: "sources", label: "Sources" },
  { id: "focus", label: "Focus" },
  { id: "ready", label: "Ready" },
];

const RHYTHM_OPTIONS: readonly {
  id: RhythmId;
  title: string;
  description: string;
  time: string;
  Icon: IconType;
}[] = [
  {
    id: "morning",
    title: "Morning Briefing",
    description: "Start the day with priorities, context, and open actions.",
    time: "08:00",
    Icon: FiClock,
  },
  {
    id: "afternoon",
    title: "Afternoon Check-In",
    description: "Catch changes before the second half of the day moves on.",
    time: "13:00",
    Icon: FiRefreshCcw,
  },
  {
    id: "end_of_day",
    title: "End-of-Day Summary",
    description: "Close the loop on decisions, follow-ups, and tomorrow's focus.",
    time: "17:30",
    Icon: FiFlag,
  },
  {
    id: "custom",
    title: "Custom Schedule",
    description: "Choose a time that fits how your week actually runs.",
    time: "09:00",
    Icon: FiCalendar,
  },
];

const DEFAULT_RHYTHM = RHYTHM_OPTIONS[0]!;

const SOURCE_OPTIONS: readonly {
  id: SourceSystem;
  title: string;
  benefit: string;
  status: SourceStatus;
  selectable: boolean;
}[] = [
  {
    id: "email",
    title: "Email",
    benefit: "Find decisions, asks, and promises across important threads.",
    status: "recommended",
    selectable: false,
  },
  {
    id: "calendar",
    title: "Calendar",
    benefit: "Prepare around meetings, agendas, and timing changes.",
    status: "recommended",
    selectable: false,
  },
  {
    id: "slack",
    title: "Slack",
    benefit: "Turn channel noise into clear updates and follow-ups.",
    status: "needs_setup",
    selectable: false,
  },
  {
    id: "discord",
    title: "Discord",
    benefit: "Track community or team conversations when you are ready.",
    status: "needs_setup",
    selectable: false,
  },
  {
    id: "whatsapp",
    title: "WhatsApp",
    benefit: "Bring selected conversations into your private context layer.",
    status: "planned",
    selectable: false,
  },
  {
    id: "github",
    title: "GitHub",
    benefit: "Watch repository activity that may affect execution.",
    status: "needs_setup",
    selectable: false,
  },
  {
    id: "file_upload",
    title: "Documents",
    benefit: "Add notes or documents from inside the workspace.",
    status: "available",
    selectable: true,
  },
];

const FOCUS_OPTIONS: readonly {
  id: FocusId;
  title: string;
  description: string;
  Icon: IconType;
}[] = [
  {
    id: "updates",
    title: "Important Updates",
    description: "Surface changes that deserve your attention.",
    Icon: FiFlag,
  },
  {
    id: "actions",
    title: "Actions & Follow-Ups",
    description: "Keep commitments visible without creating another inbox.",
    Icon: FiCheck,
  },
  {
    id: "decisions",
    title: "Decisions",
    description: "Track choices made, choices pending, and why they matter.",
    Icon: FiTarget,
  },
  {
    id: "people",
    title: "People & Relationships",
    description: "Understand who is connected to each issue or action.",
    Icon: FiUsers,
  },
  {
    id: "meetings",
    title: "Meetings",
    description: "Arrive prepared and leave with the next steps clear.",
    Icon: FiCalendar,
  },
  {
    id: "documents",
    title: "Documents & Notes",
    description: "Let key written context inform your briefing.",
    Icon: FiFileText,
  },
];

const STATUS_COPY: Record<SourceStatus, string> = {
  available: "Available Now",
  recommended: "Recommended",
  needs_setup: "Needs Setup",
  planned: "Planned",
};

function detectedTimezone(profile: Profile | null): string {
  if (profile?.timezone) return profile.timezone;
  if (typeof Intl !== "undefined") {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return "UTC";
}

function inferRhythm(time: string | null | undefined): RhythmId {
  const hour = Number((time ?? "").slice(0, 2));
  if (Number.isNaN(hour)) return "morning";
  if (hour >= 16) return "end_of_day";
  if (hour >= 11) return "afternoon";
  return "morning";
}

function displayTime(value: string): string {
  const [hour, minute] = value.split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sourceLabel(id: SourceSystem): string {
  return SOURCE_OPTIONS.find((source) => source.id === id)?.title ?? id;
}

function focusLabel(id: FocusId): string {
  return FOCUS_OPTIONS.find((focus) => focus.id === id)?.title ?? id;
}

export function OnboardingWizard({
  profile,
  onComplete,
  onDismiss,
}: {
  profile: Profile | null;
  onComplete?: () => void;
  onDismiss?: () => void;
}) {
  const router = useRouter();
  const initialTime = (profile?.briefing_time as string | null)?.slice(0, 5) || "08:00";
  const [step, setStep] = useState<StepId>("welcome");
  const [timezone, setTimezone] = useState<string>(() => detectedTimezone(profile));
  const [rhythm, setRhythm] = useState<RhythmId>(() => inferRhythm(profile?.briefing_time));
  const [briefingTime, setBriefingTime] = useState<string>(initialTime);
  const [syncSources, setSyncSources] = useState<SourceSystem[]>([]);
  const [focusAreas, setFocusAreas] = useState<FocusId[]>(["actions", "decisions", "people"]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const selectedRhythm =
    RHYTHM_OPTIONS.find((item) => item.id === rhythm) ?? DEFAULT_RHYTHM;
  const selectedSources = syncSources.map(sourceLabel);
  const selectedFocus = focusAreas.map(focusLabel);

  const footer = (() => {
    switch (step) {
      case "welcome":
        return {
          primary: "Set Briefing Rhythm",
          onPrimary: () => setStep("rhythm"),
        };
      case "rhythm":
        return {
          secondary: "Back",
          onSecondary: () => setStep("welcome"),
          primary: "Review Sources",
          onPrimary: () => setStep("sources"),
        };
      case "sources":
        return {
          secondary: "Back",
          onSecondary: () => setStep("rhythm"),
          quiet: "Finish Later",
          onQuiet: () => setStep("focus"),
          primary: "Choose Focus",
          onPrimary: () => setStep("focus"),
        };
      case "focus":
        return {
          secondary: "Back",
          onSecondary: () => setStep("sources"),
          primary: "Review Setup",
          onPrimary: () => setStep("ready"),
        };
      case "ready":
      default:
        return {
          secondary: "Adjust Setup",
          onSecondary: () => setStep("rhythm"),
          primary: isSubmitting ? "Opening Workspace..." : "Open My Workspace",
          onPrimary: handleComplete,
          primaryDisabled: isSubmitting,
          secondaryDisabled: isSubmitting,
        };
    }
  })();

  function chooseRhythm(nextRhythm: RhythmId, time: string) {
    setRhythm(nextRhythm);
    setBriefingTime(time);
  }

  function toggleSource(source: SourceSystem) {
    setSyncSources((current) =>
      current.includes(source)
        ? current.filter((item) => item !== source)
        : [...current, source],
    );
  }

  function toggleFocus(focus: FocusId) {
    setFocusAreas((current) =>
      current.includes(focus)
        ? current.filter((item) => item !== focus)
        : [...current, focus],
    );
  }

  async function handleComplete() {
    setIsSubmitting(true);
    setError(null);
    startTransition(async () => {
      const res = await completeOnboardingAction({
        timezone,
        briefingTime,
        syncSources,
      });
      if (!res.ok) {
        setIsSubmitting(false);
        setError(
          "We could not save your setup. Please check your connection and try again.",
        );
        return;
      }
      onComplete?.();
      router.refresh();
    });
  }

  return (
    <div className="onboarding-canvas">
      <OnboardingShell
        titleId={`onboarding-step-${step}`}
        onDismiss={onDismiss}
      >
        <OnboardingPreviewPanel
          briefingTime={briefingTime}
          selectedFocus={selectedFocus}
          selectedSources={selectedSources}
        />

        <section
          className={`onboarding-stage onboarding-stage--${step}`}
          aria-labelledby={`onboarding-step-${step}`}
        >
          <OnboardingProgress currentIndex={stepIndex} />

          {step === "welcome" ? (
            <div className="onboarding-step onboarding-step--welcome">
              <BrandMark size={44} className="onboarding-step__mark" />
              <OnboardingStepHeader
                id="onboarding-step-welcome"
                eyebrow="First Run Setup"
                title="Welcome to Paylo.one"
                description="Turn scattered information into a clear daily briefing, organised actions, and useful context."
              />
              <div className="onboarding-value-grid" aria-label="What Paylo.one prepares">
                {[
                  ["Briefing", "A calm view of what changed."],
                  ["Actions", "Follow-ups kept in sight."],
                  ["Sources", "Only what you choose to connect."],
                  ["People", "Context tied back to relationships."],
                  ["Memory", "Useful history without the noise."],
                ].map(([title, body]) => (
                  <div className="onboarding-value" key={title}>
                    <span>{title}</span>
                    <p>{body}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {step === "rhythm" ? (
            <div className="onboarding-step">
              <OnboardingStepHeader
                id="onboarding-step-rhythm"
                eyebrow="Step 2 of 5"
                title="Set Your Briefing Rhythm"
                description="Choose when Paylo.one should prepare your briefing. You can change this later from Settings."
              />
              <div className="onboarding-choice-grid onboarding-choice-grid--two">
                {RHYTHM_OPTIONS.map((option) => (
                  <OnboardingChoiceCard
                    key={option.id}
                    title={option.title}
                    description={option.description}
                    meta={displayTime(option.time)}
                    Icon={option.Icon}
                    selected={rhythm === option.id}
                    onClick={() => chooseRhythm(option.id, option.time)}
                  />
                ))}
              </div>
              <div className="onboarding-rhythm-fields">
                <div className="onboarding-field">
                  <label htmlFor="onboarding-timezone">Timezone</label>
                  <input
                    id="onboarding-timezone"
                    name="timezone"
                    type="text"
                    autoComplete="off"
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                  />
                  <p>Detected from your browser.</p>
                </div>
                <div className="onboarding-field">
                  <label htmlFor="onboarding-briefing-time">
                    {rhythm === "custom" ? "Custom Briefing Time" : "Briefing Time"}
                  </label>
                  <input
                    id="onboarding-briefing-time"
                    name="briefingTime"
                    type="time"
                    value={briefingTime}
                    onChange={(event) => {
                      setRhythm("custom");
                      setBriefingTime(event.target.value);
                    }}
                  />
                  <p>Your briefing will be ready around this time.</p>
                </div>
              </div>
            </div>
          ) : null}

          {step === "sources" ? (
            <div className="onboarding-step">
              <OnboardingStepHeader
                id="onboarding-step-sources"
                eyebrow="Step 3 of 5"
                title="Connect Your First Sources"
                description="Start with what is useful. Anything that needs extra setup can be finished from Sources after onboarding."
              />
              <div className="onboarding-source-grid">
                {SOURCE_OPTIONS.map((source) => (
                  <OnboardingSourceCard
                    key={source.id}
                    source={source.id}
                    title={source.title}
                    benefit={source.benefit}
                    status={source.status}
                    selectable={source.selectable}
                    selected={syncSources.includes(source.id)}
                    onToggle={() => toggleSource(source.id)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {step === "focus" ? (
            <div className="onboarding-step">
              <OnboardingStepHeader
                id="onboarding-step-focus"
                eyebrow="Step 4 of 5"
                title="Choose What Matters"
                description="Pick the areas Paylo.one should keep especially visible in your first briefings."
              />
              <div className="onboarding-choice-grid onboarding-choice-grid--three">
                {FOCUS_OPTIONS.map((focus) => (
                  <OnboardingChoiceCard
                    key={focus.id}
                    title={focus.title}
                    description={focus.description}
                    Icon={focus.Icon}
                    selected={focusAreas.includes(focus.id)}
                    onClick={() => toggleFocus(focus.id)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {step === "ready" ? (
            <div className="onboarding-step">
              <OnboardingStepHeader
                id="onboarding-step-ready"
                eyebrow="Step 5 of 5"
                title="Your Workspace Is Ready"
                description="Here is the first version of your setup. Open the workspace now, then connect any remaining sources when you are ready."
              />
              <div className="onboarding-summary">
                <SummaryRow label="Briefing Rhythm" value={`${selectedRhythm.title} at ${displayTime(briefingTime)}`} />
                <SummaryRow label="Timezone" value={timezone} />
                <SummaryRow
                  label="Connected Sources"
                  value={selectedSources.length > 0 ? selectedSources.join(", ") : "No sources selected yet"}
                />
                <SummaryRow
                  label="Focus Areas"
                  value={selectedFocus.length > 0 ? selectedFocus.join(", ") : "Important updates"}
                />
                <SummaryRow
                  label="Next Recommended Action"
                  value="Connect Email or Calendar from Sources"
                />
              </div>
              {error ? (
                <p className="onboarding-error" role="alert" aria-live="polite">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          <OnboardingFooterActions {...footer} />
        </section>
      </OnboardingShell>
      <OnboardingStyles />
    </div>
  );
}

function OnboardingShell({
  children,
  titleId,
  onDismiss,
}: {
  children: ReactNode;
  titleId: string;
  onDismiss?: () => void;
}) {
  return (
    <section
      className="onboarding-shell"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {onDismiss ? (
        <button
          type="button"
          className="onboarding-shell__close"
          aria-label="Close setup guide"
          onClick={onDismiss}
        >
          <FiX aria-hidden="true" />
        </button>
      ) : null}
      {children}
    </section>
  );
}

function OnboardingStepHeader({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="onboarding-step-header">
      <p className="onboarding-eyebrow">{eyebrow}</p>
      <h1 id={id}>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function OnboardingProgress({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="onboarding-progress" aria-label="Onboarding progress">
      {STEPS.map((item, index) => {
        const complete = index < currentIndex;
        const current = index === currentIndex;
        return (
          <li
            key={item.id}
            className={[
              "onboarding-progress__item",
              complete ? "onboarding-progress__item--complete" : "",
              current ? "onboarding-progress__item--current" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-current={current ? "step" : undefined}
          >
            <span>{complete ? <FiCheck aria-hidden="true" /> : index + 1}</span>
            <p>{item.label}</p>
          </li>
        );
      })}
    </ol>
  );
}

function OnboardingChoiceCard({
  title,
  description,
  meta,
  Icon,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  meta?: string;
  Icon: IconType;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`onboarding-choice-card ${selected ? "onboarding-choice-card--selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="onboarding-choice-card__icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="onboarding-choice-card__body">
        <span className="onboarding-choice-card__title">{title}</span>
        <span className="onboarding-choice-card__description">{description}</span>
      </span>
      {meta ? <span className="onboarding-choice-card__meta">{meta}</span> : null}
    </button>
  );
}

function OnboardingSourceCard({
  source,
  title,
  benefit,
  status,
  selectable,
  selected,
  onToggle,
}: {
  source: SourceSystem;
  title: string;
  benefit: string;
  status: SourceStatus;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const cardClass = [
    "onboarding-source-card",
    selected ? "onboarding-source-card--selected" : "",
    selectable ? "" : "onboarding-source-card--passive",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cardClass}
      aria-pressed={selectable ? selected : undefined}
      disabled={!selectable}
      onClick={onToggle}
    >
      <span className="onboarding-source-card__top">
        <SourceIcon system={source} className="onboarding-source-card__icon" size={18} />
        <span className={`onboarding-status onboarding-status--${status}`}>
          {STATUS_COPY[status]}
        </span>
      </span>
      <span className="onboarding-source-card__title">{title}</span>
      <span className="onboarding-source-card__benefit">{benefit}</span>
      <span className="onboarding-source-card__action">
        {selectable ? (selected ? "Added to setup" : "Add to setup") : "Finish in Sources"}
      </span>
    </button>
  );
}

function OnboardingPreviewPanel({
  briefingTime,
  selectedFocus,
  selectedSources,
}: {
  briefingTime: string;
  selectedFocus: readonly string[];
  selectedSources: readonly string[];
}) {
  return (
    <aside className="onboarding-preview" aria-label="Workspace preview">
      <div className="onboarding-preview__brand">
        <BrandMark size={30} />
        <div>
          <p>Paylo.one</p>
          <span>Private Management OS</span>
        </div>
      </div>
      <div className="onboarding-preview__briefing">
        <span className="onboarding-preview__label">Tomorrow&apos;s Briefing</span>
        <h2>{displayTime(briefingTime)}</h2>
        <p>
          A concise readout of important changes, open actions, and context you
          can trust.
        </p>
      </div>
      <div className="onboarding-preview__stack">
        <PreviewItem
          Icon={FiBriefcase}
          title="Briefing"
          text="Ranked updates with source references."
        />
        <PreviewItem
          Icon={FiCheck}
          title="Actions"
          text="Follow-ups grouped by importance."
        />
        <PreviewItem
          Icon={FiMessageCircle}
          title="Context"
          text={
            selectedSources.length > 0
              ? `${selectedSources.join(", ")} ready to shape the workspace.`
              : "Sources stay private and optional."
          }
        />
      </div>
      <div className="onboarding-preview__focus">
        <span>Focus Areas</span>
        <p>{selectedFocus.length > 0 ? selectedFocus.join(" / ") : "Actions / Decisions / People"}</p>
      </div>
    </aside>
  );
}

function PreviewItem({
  Icon,
  title,
  text,
}: {
  Icon: IconType;
  title: string;
  text: string;
}) {
  return (
    <div className="onboarding-preview-item">
      <span aria-hidden="true">
        <Icon />
      </span>
      <div>
        <p>{title}</p>
        <small>{text}</small>
      </div>
    </div>
  );
}

function OnboardingFooterActions({
  primary,
  secondary,
  quiet,
  onPrimary,
  onSecondary,
  onQuiet,
  primaryDisabled,
  secondaryDisabled,
}: {
  primary: string;
  secondary?: string;
  quiet?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
  onQuiet?: () => void;
  primaryDisabled?: boolean;
  secondaryDisabled?: boolean;
}) {
  return (
    <footer className="onboarding-footer-actions">
      <div>
        {secondary && onSecondary ? (
          <button
            type="button"
            className="onboarding-btn onboarding-btn--secondary"
            disabled={secondaryDisabled}
            onClick={onSecondary}
          >
            <FiArrowLeft aria-hidden="true" />
            {secondary}
          </button>
        ) : null}
      </div>
      <div className="onboarding-footer-actions__right">
        {quiet && onQuiet ? (
          <button type="button" className="onboarding-btn onboarding-btn--quiet" onClick={onQuiet}>
            {quiet}
          </button>
        ) : null}
        <button
          type="button"
          className="onboarding-btn onboarding-btn--primary"
          disabled={primaryDisabled}
          onClick={onPrimary}
        >
          {primary}
          <FiArrowRight aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="onboarding-summary__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function OnboardingStyles() {
  return (
    <style jsx global>{`
      .onboarding-canvas {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: max(24px, env(safe-area-inset-top))
          max(18px, env(safe-area-inset-right))
          max(24px, env(safe-area-inset-bottom))
          max(18px, env(safe-area-inset-left));
        background:
          linear-gradient(135deg, rgba(244, 245, 247, 0.96), rgba(232, 239, 245, 0.92)),
          var(--colour-bg);
      }

      .onboarding-shell {
        position: relative;
        width: min(1120px, 100%);
        min-height: min(740px, calc(100vh - 48px));
        display: grid;
        grid-template-columns: minmax(300px, 0.82fr) minmax(0, 1.18fr);
        border: 1px solid rgba(17, 24, 39, 0.1);
        border-radius: var(--radius-lg);
        background: rgba(255, 255, 255, 0.86);
        box-shadow: 0 28px 80px rgba(15, 23, 42, 0.18);
        overflow: hidden;
      }

      .onboarding-shell__close {
        position: absolute;
        top: 14px;
        right: 14px;
        z-index: 2;
        display: grid;
        width: 36px;
        height: 36px;
        place-items: center;
        border: 1px solid var(--colour-border);
        border-radius: var(--radius-pill);
        background: rgba(255, 255, 255, 0.86);
        color: var(--colour-text-secondary);
        cursor: pointer;
        touch-action: manipulation;
        transition:
          background var(--speed) var(--ease-standard),
          color var(--speed) var(--ease-standard),
          border-color var(--speed) var(--ease-standard);
      }

      .onboarding-shell__close:hover {
        border-color: var(--colour-border-strong);
        background: var(--colour-surface-elevated);
        color: var(--colour-text-primary);
      }

      .onboarding-preview {
        display: flex;
        flex-direction: column;
        gap: var(--space-lg);
        padding: 32px;
        background: #15181d;
        color: var(--colour-command-text);
      }

      .onboarding-preview__brand {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        color: var(--colour-command-accent);
      }

      .onboarding-preview__brand p {
        margin: 0;
        color: var(--colour-command-text);
        font-weight: 700;
      }

      .onboarding-preview__brand span {
        display: block;
        margin-top: 2px;
        color: var(--colour-command-text-muted);
        font-size: var(--text-small);
      }

      .onboarding-preview__briefing {
        margin-top: auto;
        padding-top: var(--space-xl);
      }

      .onboarding-preview__label,
      .onboarding-preview__focus span {
        display: block;
        color: var(--colour-command-accent);
        font-family: var(--font-mono);
        font-size: var(--text-label);
        letter-spacing: var(--tracking-label);
        text-transform: uppercase;
      }

      .onboarding-preview__briefing h2 {
        margin: var(--space-sm) 0;
        font-size: clamp(2rem, 5vw, 4.4rem);
        letter-spacing: 0;
        line-height: 0.95;
        font-variant-numeric: tabular-nums;
      }

      .onboarding-preview__briefing p,
      .onboarding-preview__focus p {
        margin: 0;
        color: rgba(232, 234, 237, 0.72);
        line-height: var(--leading-snug);
      }

      .onboarding-preview__stack {
        display: grid;
        gap: var(--space-sm);
      }

      .onboarding-preview-item {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: var(--space-sm);
        align-items: start;
        padding: 12px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }

      .onboarding-preview-item > span {
        display: grid;
        width: 30px;
        height: 30px;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: var(--radius-md);
        color: var(--colour-command-accent);
      }

      .onboarding-preview-item p,
      .onboarding-preview-item small {
        margin: 0;
      }

      .onboarding-preview-item p {
        font-weight: 700;
      }

      .onboarding-preview-item small {
        display: block;
        margin-top: 3px;
        color: var(--colour-command-text-muted);
        line-height: var(--leading-snug);
      }

      .onboarding-preview__focus {
        padding-top: var(--space-md);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }

      .onboarding-preview__focus p {
        margin-top: var(--space-xs);
      }

      .onboarding-stage {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        min-width: 0;
        padding: 28px;
        background: rgba(251, 251, 253, 0.94);
      }

      .onboarding-stage--sources {
        padding: 22px 28px 24px;
      }

      .onboarding-progress {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: var(--space-sm);
        margin: 0 0 28px;
        padding: 0;
        list-style: none;
      }

      .onboarding-progress__item {
        min-width: 0;
        color: var(--colour-text-muted);
      }

      .onboarding-progress__item span {
        display: grid;
        width: 28px;
        height: 28px;
        place-items: center;
        border: 1px solid var(--colour-border);
        border-radius: var(--radius-pill);
        background: var(--colour-surface-elevated);
        font-size: var(--text-label);
        font-weight: 700;
        transition:
          border-color var(--speed) var(--ease-standard),
          background var(--speed) var(--ease-standard),
          color var(--speed) var(--ease-standard);
      }

      .onboarding-progress__item p {
        margin: 7px 0 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--text-label);
        font-weight: 700;
      }

      .onboarding-progress__item--complete span,
      .onboarding-progress__item--current span {
        border-color: var(--colour-accent);
        background: var(--colour-accent);
        color: var(--colour-accent-on);
      }

      .onboarding-progress__item--current p {
        color: var(--colour-text-primary);
      }

      .onboarding-step {
        min-width: 0;
        animation: onboarding-step-in 180ms var(--ease-standard);
      }

      .onboarding-step--welcome {
        display: flex;
        min-height: 100%;
        flex-direction: column;
        justify-content: center;
      }

      .onboarding-step__mark {
        margin-bottom: var(--space-lg);
        color: var(--colour-accent);
      }

      .onboarding-step-header {
        max-width: 680px;
      }

      .onboarding-eyebrow {
        margin: 0 0 var(--space-sm);
        color: var(--colour-accent);
        font-family: var(--font-mono);
        font-size: var(--text-label);
        letter-spacing: var(--tracking-label);
        text-transform: uppercase;
      }

      .onboarding-step-header h1 {
        margin: 0;
        max-width: 760px;
        color: var(--colour-text-primary);
        font-size: clamp(2rem, 4vw, 3.55rem);
        line-height: 0.98;
        letter-spacing: 0;
        text-wrap: balance;
      }

      .onboarding-stage--sources .onboarding-step-header h1 {
        font-size: clamp(1.9rem, 3vw, 2.8rem);
        line-height: 1;
      }

      .onboarding-stage--sources .onboarding-step-header p:last-child {
        margin-top: var(--space-sm);
        font-size: var(--text-body);
      }

      .onboarding-step-header p:last-child {
        margin: var(--space-md) 0 0;
        max-width: 660px;
        color: var(--colour-text-secondary);
        font-size: 1.02rem;
        line-height: var(--leading-normal);
        text-wrap: pretty;
      }

      .onboarding-value-grid,
      .onboarding-choice-grid,
      .onboarding-source-grid {
        display: grid;
        gap: var(--space-sm);
        margin-top: 28px;
      }

      .onboarding-value-grid {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }

      .onboarding-value {
        min-width: 0;
        padding-top: var(--space-sm);
        border-top: 2px solid var(--colour-accent);
      }

      .onboarding-value span {
        display: block;
        font-weight: 800;
      }

      .onboarding-value p {
        margin: 6px 0 0;
        color: var(--colour-text-secondary);
        font-size: var(--text-small);
        line-height: var(--leading-snug);
      }

      .onboarding-choice-grid--two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .onboarding-choice-grid--three,
      .onboarding-source-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .onboarding-source-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-top: var(--space-md);
      }

      .onboarding-choice-card,
      .onboarding-source-card {
        min-width: 0;
        min-height: 150px;
        border: 1px solid var(--colour-border);
        border-radius: var(--radius-lg);
        background: var(--colour-surface-elevated);
        color: var(--colour-text-primary);
        text-align: left;
        cursor: pointer;
        touch-action: manipulation;
        transition:
          border-color var(--speed) var(--ease-standard),
          background var(--speed) var(--ease-standard),
          transform var(--speed) var(--ease-standard),
          box-shadow var(--speed) var(--ease-standard);
      }

      .onboarding-choice-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--space-sm);
        align-items: start;
        padding: 16px;
      }

      .onboarding-choice-card:hover,
      .onboarding-source-card:hover:not(:disabled) {
        border-color: var(--colour-border-strong);
        transform: translateY(-1px);
        box-shadow: var(--shadow-card);
      }

      .onboarding-choice-card:focus-visible,
      .onboarding-source-card:focus-visible,
      .onboarding-btn:focus-visible,
      .onboarding-field input:focus-visible {
        outline: 2px solid var(--colour-accent);
        outline-offset: 3px;
      }

      .onboarding-choice-card--selected,
      .onboarding-source-card--selected {
        border-color: var(--colour-accent);
        background: var(--colour-accent-tint);
      }

      .onboarding-choice-card__icon {
        display: grid;
        width: 34px;
        height: 34px;
        place-items: center;
        border-radius: var(--radius-md);
        background: var(--colour-surface-sunken);
        color: var(--colour-accent);
      }

      .onboarding-choice-card--selected .onboarding-choice-card__icon {
        background: var(--colour-accent);
        color: var(--colour-accent-on);
      }

      .onboarding-choice-card__body,
      .onboarding-choice-card__title,
      .onboarding-choice-card__description,
      .onboarding-choice-card__meta,
      .onboarding-source-card__title,
      .onboarding-source-card__benefit,
      .onboarding-source-card__action {
        display: block;
        min-width: 0;
      }

      .onboarding-choice-card__title,
      .onboarding-source-card__title {
        font-weight: 800;
      }

      .onboarding-choice-card__description,
      .onboarding-source-card__benefit {
        margin-top: 7px;
        color: var(--colour-text-secondary);
        font-size: var(--text-small);
        line-height: var(--leading-snug);
      }

      .onboarding-choice-card__meta {
        grid-column: 2;
        margin-top: auto;
        color: var(--colour-accent);
        font-family: var(--font-mono);
        font-size: var(--text-label);
        font-variant-numeric: tabular-nums;
        letter-spacing: var(--tracking-label);
      }

      .onboarding-rhythm-fields {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: var(--space-sm);
        margin-top: var(--space-md);
      }

      .onboarding-field {
        display: grid;
        gap: 6px;
      }

      .onboarding-field label {
        font-size: var(--text-label);
        font-weight: 800;
        color: var(--colour-text-secondary);
      }

      .onboarding-field input {
        min-width: 0;
        height: 44px;
        border: 1px solid var(--colour-border);
        border-radius: var(--radius-md);
        background: var(--colour-surface-elevated);
        color: var(--colour-text-primary);
        font: inherit;
        padding: 0 12px;
      }

      .onboarding-field p {
        margin: 0;
        color: var(--colour-text-tertiary);
        font-size: var(--text-label);
      }

      .onboarding-source-card {
        display: flex;
        flex-direction: column;
        min-height: 138px;
        padding: 13px;
      }

      .onboarding-source-card:disabled {
        cursor: default;
      }

      .onboarding-source-card--passive {
        background: rgba(255, 255, 255, 0.64);
      }

      .onboarding-source-card__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        margin-bottom: var(--space-sm);
      }

      .onboarding-source-card .integration__glyph {
        width: 34px;
        height: 34px;
        border-radius: var(--radius-md);
        border-color: var(--colour-border);
        background: var(--colour-surface-sunken);
      }

      .onboarding-status {
        flex: 0 0 auto;
        border: 1px solid var(--colour-border);
        border-radius: var(--radius-pill);
        padding: 3px 8px;
        font-size: var(--text-label);
        font-weight: 800;
      }

      .onboarding-status--available {
        border-color: rgba(47, 125, 91, 0.28);
        background: var(--colour-success-tint);
        color: var(--colour-success);
      }

      .onboarding-status--recommended {
        border-color: rgba(21, 122, 134, 0.28);
        background: var(--colour-accent-tint);
        color: var(--colour-accent);
      }

      .onboarding-status--needs_setup {
        border-color: rgba(138, 101, 20, 0.26);
        background: var(--colour-warning-tint);
        color: var(--colour-warning);
      }

      .onboarding-status--planned {
        background: var(--colour-surface-sunken);
        color: var(--colour-text-secondary);
      }

      .onboarding-source-card__action {
        margin-top: auto;
        padding-top: var(--space-sm);
        color: var(--colour-accent);
        font-size: var(--text-small);
        font-weight: 800;
      }

      .onboarding-stage--sources .onboarding-footer-actions {
        margin-top: var(--space-md);
      }

      .onboarding-summary {
        display: grid;
        gap: var(--space-sm);
        margin-top: 28px;
      }

      .onboarding-summary__row {
        display: grid;
        grid-template-columns: 180px minmax(0, 1fr);
        gap: var(--space-md);
        padding: 14px 0;
        border-bottom: 1px solid var(--colour-border);
      }

      .onboarding-summary__row dt,
      .onboarding-summary__row dd {
        margin: 0;
      }

      .onboarding-summary__row dt {
        color: var(--colour-text-secondary);
        font-size: var(--text-small);
        font-weight: 800;
      }

      .onboarding-summary__row dd {
        color: var(--colour-text-primary);
        overflow-wrap: anywhere;
      }

      .onboarding-error {
        margin: var(--space-md) 0 0;
        border: 1px solid rgba(158, 60, 52, 0.22);
        border-radius: var(--radius-md);
        background: var(--colour-danger-tint);
        color: var(--colour-danger);
        padding: 12px;
        line-height: var(--leading-snug);
      }

      .onboarding-footer-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-md);
        margin-top: 28px;
        padding-top: var(--space-md);
        border-top: 1px solid var(--colour-border);
      }

      .onboarding-footer-actions__right {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .onboarding-btn {
        display: inline-flex;
        min-height: 44px;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        padding: 0 16px;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
        touch-action: manipulation;
        transition:
          border-color var(--speed) var(--ease-standard),
          background var(--speed) var(--ease-standard),
          color var(--speed) var(--ease-standard),
          transform var(--speed) var(--ease-standard);
      }

      .onboarding-btn:hover:not(:disabled) {
        transform: translateY(-1px);
      }

      .onboarding-btn:disabled {
        cursor: not-allowed;
        opacity: 0.58;
      }

      .onboarding-btn--primary {
        background: var(--colour-accent);
        color: var(--colour-accent-on);
      }

      .onboarding-btn--primary:hover:not(:disabled) {
        background: var(--colour-accent-hover);
      }

      .onboarding-btn--secondary {
        border-color: var(--colour-border-strong);
        background: var(--colour-surface-elevated);
        color: var(--colour-text-primary);
      }

      .onboarding-btn--secondary:hover:not(:disabled),
      .onboarding-btn--quiet:hover:not(:disabled) {
        background: var(--colour-surface-sunken);
      }

      .onboarding-btn--quiet {
        background: transparent;
        color: var(--colour-text-secondary);
      }

      @keyframes onboarding-step-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .onboarding-step {
          animation: none;
        }

        .onboarding-choice-card,
        .onboarding-source-card,
        .onboarding-btn,
        .onboarding-progress__item span {
          transition: none;
        }

        .onboarding-choice-card:hover,
        .onboarding-source-card:hover:not(:disabled),
        .onboarding-btn:hover:not(:disabled) {
          transform: none;
        }
      }

      @media (max-width: 920px) {
        .onboarding-canvas {
          align-items: start;
        }

        .onboarding-shell {
          min-height: 0;
          grid-template-columns: 1fr;
        }

        .onboarding-preview {
          padding: 22px;
        }

        .onboarding-preview__briefing {
          margin-top: 0;
          padding-top: var(--space-md);
        }

        .onboarding-stage {
          padding: 22px;
        }

        .onboarding-value-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .onboarding-source-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 680px) {
        .onboarding-canvas {
          padding: 0;
        }

        .onboarding-shell {
          width: 100%;
          min-height: 100vh;
          border: 0;
          border-radius: 0;
        }

        .onboarding-progress {
          grid-template-columns: repeat(5, 1fr);
        }

        .onboarding-progress__item p {
          display: none;
        }

        .onboarding-choice-grid--two,
        .onboarding-choice-grid--three,
        .onboarding-source-grid,
        .onboarding-rhythm-fields {
          grid-template-columns: 1fr;
        }

        .onboarding-step-header h1 {
          font-size: 2rem;
        }

        .onboarding-value-grid {
          grid-template-columns: 1fr;
        }

        .onboarding-summary__row {
          grid-template-columns: 1fr;
          gap: 4px;
        }

        .onboarding-footer-actions,
        .onboarding-footer-actions__right {
          align-items: stretch;
          flex-direction: column;
        }

        .onboarding-footer-actions > div,
        .onboarding-btn {
          width: 100%;
        }
      }
    `}</style>
  );
}
