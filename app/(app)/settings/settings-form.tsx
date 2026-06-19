"use client";

/**
 * Editable profile form for the Settings surface. Persists display name,
 * timezone, and preferred briefing time to the signed-in user's profile via the
 * saveProfileAction server action. Holds no tenant state of its own.
 */

import { useActionState } from "react";
import { saveProfileAction } from "./actions";
import { initialProfileFormState } from "./types";

export interface ProfileFormValues {
  displayName: string;
  timezone: string;
  briefingTime: string;
}

export function SettingsProfileForm({ values }: { values: ProfileFormValues }) {
  const [state, action, pending] = useActionState(
    saveProfileAction,
    initialProfileFormState,
  );

  return (
    <form action={action} className="card" style={{ maxWidth: "520px" }}>
      <div className="field">
        <label htmlFor="display_name" className="field__label">
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          defaultValue={values.displayName}
          placeholder="How you appear in the workspace"
          className="input"
        />
      </div>

      <div className="field">
        <label htmlFor="timezone" className="field__label">
          Timezone
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
        <span className="field__hint">
          Drives when your daily briefing is prepared.
        </span>
      </div>

      <div className="field">
        <label htmlFor="briefing_time" className="field__label">
          Briefing time
        </label>
        <input
          id="briefing_time"
          name="briefing_time"
          type="time"
          defaultValue={values.briefingTime}
          className="input"
        />
      </div>

      {state.error ? (
        <p className="form-message form-message--error">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p className="form-message form-message--ok">Profile saved.</p>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn--primary">
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
