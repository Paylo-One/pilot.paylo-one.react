export type SignupMode = "gated" | "open";

/**
 * Resolve account-creation policy. Missing configuration is deliberately
 * fail-closed so a hosted deployment cannot become public by accident.
 */
export function signupMode(value = process.env.PILOT_SIGNUP_MODE): SignupMode {
  const configured = value?.trim().toLowerCase();
  if (!configured) return "gated";
  if (configured === "gated" || configured === "open") return configured;
  throw new Error('PILOT_SIGNUP_MODE must be "gated" or "open"');
}

export function openSignupEnabled(value = process.env.PILOT_SIGNUP_MODE): boolean {
  return signupMode(value) === "open";
}

export function accessGrantForSignup(
  value = process.env.PILOT_SIGNUP_MODE,
): "paid" | "complimentary" {
  return openSignupEnabled(value) ? "complimentary" : "paid";
}
