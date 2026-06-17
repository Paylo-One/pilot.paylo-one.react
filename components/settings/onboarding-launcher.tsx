"use client";

import { useState } from "react";
import { FiCompass } from "react-icons/fi";
import { OnboardingWizard } from "@/components/onboarding-wizard";

interface Profile {
  display_name: string | null;
  timezone: string;
  briefing_time: string | null;
}

export function OnboardingLauncher({ profile }: { profile: Profile | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={() => setOpen(true)}
      >
        <FiCompass aria-hidden="true" />
        Open Setup Guide
      </button>
      {open ? (
        <OnboardingWizard
          profile={profile}
          onComplete={() => setOpen(false)}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
