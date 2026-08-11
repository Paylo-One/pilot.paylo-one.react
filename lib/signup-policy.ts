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

export interface TenantProvisioningPolicy {
  readonly accessGrantType: "paid" | "complimentary";
  readonly paymentEnforcementExempt: boolean;
  readonly initialiseHostedBilling: boolean;
}

/** The complete persistent-access and billing contract for a signup mode. */
export function tenantProvisioningPolicy(
  mode: SignupMode,
): TenantProvisioningPolicy {
  return mode === "open"
    ? {
        accessGrantType: "complimentary",
        paymentEnforcementExempt: true,
        initialiseHostedBilling: false,
      }
    : {
        accessGrantType: "paid",
        paymentEnforcementExempt: false,
        initialiseHostedBilling: true,
      };
}
