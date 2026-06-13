interface RegistrationProgressProps {
  current: 1 | 2 | 3;
}

const STEPS = [
  { number: 1, label: "Invitation" },
  { number: 2, label: "Identity" },
  { number: 3, label: "Workspace" },
] as const;

export function RegistrationProgress({ current }: RegistrationProgressProps) {
  return (
    <ol className="registration-progress" aria-label="Registration progress">
      {STEPS.map((step) => {
        const state =
          step.number < current
            ? "complete"
            : step.number === current
              ? "current"
              : "upcoming";
        return (
          <li
            key={step.number}
            className={`registration-progress__step registration-progress__step--${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="registration-progress__number">
              {state === "complete" ? "✓" : step.number}
            </span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
