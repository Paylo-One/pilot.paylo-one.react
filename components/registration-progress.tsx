import { getTranslations } from "next-intl/server";

interface RegistrationProgressProps {
  current: 1 | 2 | 3;
}

const STEPS = [
  { number: 1, key: "invitation" },
  { number: 2, key: "identity" },
  { number: 3, key: "workspace" },
] as const;

export async function RegistrationProgress({ current }: RegistrationProgressProps) {
  const t = await getTranslations("auth.registration");
  return (
    <ol className="registration-progress" aria-label={t("label")}>
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
            <span>{t(`steps.${step.key}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}
