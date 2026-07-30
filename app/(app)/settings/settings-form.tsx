"use client";

/**
 * Editable profile form for the Settings surface. Persists display name,
 * timezone, and preferred briefing time to the signed-in user's profile via the
 * saveProfileAction server action. Holds no tenant state of its own.
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveProfileAction } from "./actions";
import { initialProfileFormState } from "./types";

export interface ProfileFormValues {
  displayName: string;
  timezone: string;
  briefingTime: string;
  dailyBriefingEmail: boolean;
}

export function SettingsProfileForm({ values }: { values: ProfileFormValues }) {
  const t = useTranslations("settings.profile");
  const [state, action, pending] = useActionState(
    saveProfileAction,
    initialProfileFormState,
  );

  return (
    <form action={action} className="card" style={{ maxWidth: "520px" }}>
      <div className="field">
        <label htmlFor="display_name" className="field__label">
          {t("displayName")}
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          defaultValue={values.displayName}
          placeholder={t("displayNamePlaceholder")}
          className="input"
        />
      </div>

      <div className="field">
        <label htmlFor="timezone" className="field__label">
          {t("timezone")}
        </label>
        <select
          id="timezone"
          name="timezone"
          defaultValue={values.timezone || "UTC"}
          className="input select"
          style={{ height: "42px", padding: "0 12px" }}
        >
          {(Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"]).map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <span className="field__hint">{t("timezoneHint")}</span>
      </div>

      <div className="field">
        <label htmlFor="briefing_time" className="field__label">
          {t("briefingTime")}
        </label>
        <input
          id="briefing_time"
          name="briefing_time"
          type="time"
          defaultValue={values.briefingTime}
          className="input"
        />
      </div>

      <div className="field">
        <label
          htmlFor="daily_briefing_email"
          className="field__label"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}
        >
          <input
            id="daily_briefing_email"
            name="daily_briefing_email"
            type="checkbox"
            defaultChecked={values.dailyBriefingEmail}
          />
          {t("briefingEmail")}
        </label>
        <span className="field__hint">{t("briefingEmailHint")}</span>
      </div>

      {state.error ? (
        <p className="form-message form-message--error">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p className="form-message form-message--ok">{t("saved")}</p>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn--primary">
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
