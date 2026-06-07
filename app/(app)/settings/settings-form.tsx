"use client";

/**
 * Editable profile form for the Settings surface. Persists display name,
 * timezone, and preferred briefing time to the signed-in user's profile via the
 * saveProfileAction server action. Holds no tenant state of its own.
 */

import { useActionState } from "react";
import { saveProfileAction, initialProfileFormState } from "./actions";

export interface ProfileFormValues {
  displayName: string;
  timezone: string;
  briefingTime: string;
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--colour-surface)",
  color: "var(--colour-text-primary)",
  border: "1px solid var(--colour-border-strong)",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-sm) var(--space-md)",
  font: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "var(--space-xs)",
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: "var(--space-lg)",
  maxWidth: "420px",
};

export function SettingsProfileForm({ values }: { values: ProfileFormValues }) {
  const [state, action, pending] = useActionState(
    saveProfileAction,
    initialProfileFormState,
  );

  return (
    <form action={action} className="panel">
      <div style={fieldGroupStyle}>
        <label htmlFor="display_name" className="eyebrow" style={labelStyle}>
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          defaultValue={values.displayName}
          placeholder="How you appear in the workspace"
          style={fieldStyle}
        />
      </div>

      <div style={fieldGroupStyle}>
        <label htmlFor="timezone" className="eyebrow" style={labelStyle}>
          Timezone
        </label>
        <input
          id="timezone"
          name="timezone"
          type="text"
          defaultValue={values.timezone}
          placeholder="e.g. Europe/London"
          style={fieldStyle}
        />
        <p
          style={{
            fontSize: "var(--text-small)",
            color: "var(--colour-text-tertiary)",
            marginTop: "var(--space-xs)",
          }}
        >
          Drives when your Daily Memo is prepared.
        </p>
      </div>

      <div style={fieldGroupStyle}>
        <label htmlFor="briefing_time" className="eyebrow" style={labelStyle}>
          Briefing time
        </label>
        <input
          id="briefing_time"
          name="briefing_time"
          type="time"
          defaultValue={values.briefingTime}
          style={fieldStyle}
        />
      </div>

      {state.error ? (
        <p
          style={{
            color: "#b4423a",
            fontSize: "var(--text-small)",
            marginBottom: "var(--space-md)",
          }}
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p
          style={{
            color: "var(--colour-accent)",
            fontSize: "var(--text-small)",
            marginBottom: "var(--space-md)",
          }}
        >
          Profile saved.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        style={{
          background: "var(--colour-accent)",
          color: "var(--colour-accent-on)",
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-sm) var(--space-lg)",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
