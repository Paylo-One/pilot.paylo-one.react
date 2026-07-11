/**
 * modules/billing/plans.ts
 *
 * THE SOURCE OF TRUTH for the *shape and defaults* of plan entitlements. The DB
 * (`subscription_plans.entitlements`) carries a mirror of this for admin display
 * and the marketing site; runtime gating resolves from here, not from the DB
 * row. `tenants.plan` is a denormalised convenience mirror only.
 *
 * Dependency-free on purpose: the app (feature guards), the admin portal
 * (showing/overriding a tenant's effective entitlements), and the marketing site
 * (deriving the comparison table) all import this module so the three surfaces
 * never drift. Do NOT import server-only code here.
 *
 * Governance:
 *  - governance/docs/02-monetisation/billing-subscription-logical-design.md §5 (feature matrix) + §8 (entitlement model)
 *  - governance/docs/02-monetisation/billing-subscription-technical-design.md §4 (entitlement engine)
 *  - services/model-entitlement-service.md (AI limits feed Model Entitlement)
 *
 * Invariant (enforced by tests, technical-design §12): entitlements are
 * MONOTONIC across tiers — Operator ≤ Executive ≤ Command on every numeric
 * limit, and each tier's capability set is a superset of the one below.
 */

/** Stable plan codes. App logic keys off these, never off display names. */
export type PlanKey =
  | "plan_operator"
  | "plan_executive"
  | "plan_command"
  | "plan_enterprise";

/** Subscription lifecycle states (mirrors tenant_subscriptions.status). */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "grace"
  | "suspended"
  | "cancelled"
  | "unpaid"
  | "incomplete"
  | "expired";

export type MonitoringFrequency =
  | "scheduled_daily"
  | "hourly"
  | "near_real_time"
  | "real_time";

/**
 * Per-source automatic-refresh cadences the operator can choose (ADR-043). The
 * SET a plan unlocks is carried by `Entitlements.availableSyncFrequencies`, so
 * higher tiers can offer more granular intervals later by extending that array
 * without any UI/resolver change. "daily" is always available.
 */
export type SyncFrequency =
  | "daily"
  | "twice_a_day"
  | "three_times_a_day"
  | "four_times_a_day";

/** All custom (above-daily) cadences, used by tiers that unlock them. */
export const ALL_SYNC_FREQUENCIES: readonly SyncFrequency[] = [
  "daily",
  "twice_a_day",
  "three_times_a_day",
  "four_times_a_day",
];

export type SupportLevel = "standard" | "priority" | "dedicated";

export type AdminControlsLevel = "basic" | "standard" | "advanced" | "advanced_plus";

/**
 * The single typed contract shared by frontend, backend, admin, and marketing.
 * `null` on a numeric limit means UNLIMITED. Capability booleans gate
 * visibility/availability; numeric limits gate quantity.
 */
export interface Entitlements {
  readonly planKey: PlanKey;
  readonly status: SubscriptionStatus;

  // --- capabilities (booleans) ---------------------------------------------
  readonly canCreateActions: boolean;
  readonly canUseFollowUpNotifications: boolean;
  readonly canUseCustomSchedules: boolean;
  readonly canUseRealtimeMonitoring: boolean;
  readonly canUseAdvancedPeopleCorrelation: boolean;
  readonly canCustomisePrompts: boolean;
  readonly canUsePromptVersioning: boolean;
  readonly canUsePromptAuditTrail: boolean;
  readonly canUseBYOAgent: boolean;
  readonly canUseBYOApiKeys: boolean;
  readonly canUseCustomModels: boolean;
  readonly canUseMcpTools: boolean;
  readonly canMonitorWhatsApp: boolean;
  readonly canMonitorEmail: boolean;
  readonly canMonitorTeams: boolean;
  readonly canMonitorGitHub: boolean;
  readonly canUseObsidian: boolean;
  readonly canUsePrivateInference: boolean;
  readonly canUseSso: boolean;
  readonly canUseCustomDomain: boolean;
  readonly hasPriorityProcessing: boolean;

  // --- limits (numbers; null = unlimited) ----------------------------------
  readonly maxConnectedSources: number | null;
  readonly maxBriefingsPerDay: number | null;
  readonly maxPeopleRecords: number | null;
  readonly maxAutomations: number | null;
  readonly maxKnowledgeBaseStorageMb: number | null;
  readonly maxFileUploadsPerMonth: number | null;
  readonly maxDiaryEntriesPerMonth: number | null;
  readonly monthlyAiTokenAllowance: number | null;
  readonly dataRetentionDays: number | null;
  /** BYO AI agent slots; null = unlimited. */
  readonly byoAgentSlots: number | null;

  // --- enums ----------------------------------------------------------------
  readonly monitoringFrequency: MonitoringFrequency;
  readonly supportLevel: SupportLevel;
  readonly adminControlsLevel: AdminControlsLevel;

  /**
   * The set of per-source auto-refresh cadences this plan unlocks (ADR-043).
   * The Source page renders only these as selectable; others are shown locked.
   * Always includes "daily". `canUseCustomSchedules` is the boolean shorthand
   * for "more than daily is available".
   */
  readonly availableSyncFrequencies: readonly SyncFrequency[];

  // --- account-state flags (set by the resolver, not by the plan default) ---
  /** True in grace/past_due: new AI processing is paused, existing data readable. */
  readonly aiPaused?: boolean;
  /** True in grace/past_due: new ingestion is paused, existing data readable. */
  readonly ingestionPaused?: boolean;
}

/**
 * Keys of `Entitlements` whose value is a plan capability (boolean). Excludes
 * the resolver-set account-state flags (`aiPaused`/`ingestionPaused`), which are
 * not plan capabilities. `-?` strips optionality so the union has no `undefined`.
 */
export type CapabilityKey = Exclude<
  NonNullable<
    {
      [K in keyof Entitlements]-?: boolean extends Entitlements[K] ? K : never;
    }[keyof Entitlements]
  >,
  "aiPaused" | "ingestionPaused"
>;

/** Keys of `Entitlements` whose value is a numeric limit (number | null). */
export type LimitKey = NonNullable<
  {
    [K in keyof Entitlements]-?: Entitlements[K] extends number | null
      ? number extends Entitlements[K]
        ? K
        : never
      : never;
  }[keyof Entitlements]
>;

// ============================================================================
// Plan defaults. Token allowances are placeholders pending the soft/hard-cap
// decision (logical-design §12.3 / implementation-plan D3).
// ============================================================================

export const PLAN_ENTITLEMENTS: Record<PlanKey, Entitlements> = {
  plan_operator: {
    planKey: "plan_operator",
    status: "active",
    canCreateActions: true,
    canUseFollowUpNotifications: false,
    canUseCustomSchedules: false,
    canUseRealtimeMonitoring: false,
    canUseAdvancedPeopleCorrelation: false,
    canCustomisePrompts: false,
    canUsePromptVersioning: false,
    canUsePromptAuditTrail: false,
    canUseBYOAgent: false,
    canUseBYOApiKeys: false,
    canUseCustomModels: false,
    canUseMcpTools: false,
    canMonitorWhatsApp: false,
    canMonitorEmail: true,
    canMonitorTeams: false,
    canMonitorGitHub: false,
    canUseObsidian: false,
    canUsePrivateInference: false,
    canUseSso: false,
    canUseCustomDomain: false,
    hasPriorityProcessing: false,
    maxConnectedSources: 3,
    maxBriefingsPerDay: 1,
    maxPeopleRecords: 50,
    maxAutomations: 2,
    maxKnowledgeBaseStorageMb: 500,
    maxFileUploadsPerMonth: 50,
    maxDiaryEntriesPerMonth: null, // fair-use, unlimited
    monthlyAiTokenAllowance: 1_000_000,
    dataRetentionDays: 90,
    byoAgentSlots: 0,
    monitoringFrequency: "scheduled_daily",
    supportLevel: "standard",
    adminControlsLevel: "basic",
    availableSyncFrequencies: ["daily"],
  },

  plan_executive: {
    planKey: "plan_executive",
    status: "active",
    canCreateActions: true,
    canUseFollowUpNotifications: true,
    canUseCustomSchedules: true,
    canUseRealtimeMonitoring: true, // limited; nuance carried by monitoringFrequency
    canUseAdvancedPeopleCorrelation: true,
    canCustomisePrompts: true,
    canUsePromptVersioning: true,
    canUsePromptAuditTrail: false,
    canUseBYOAgent: true,
    canUseBYOApiKeys: true,
    canUseCustomModels: false,
    canUseMcpTools: true, // limited
    canMonitorWhatsApp: true,
    canMonitorEmail: true,
    canMonitorTeams: true,
    canMonitorGitHub: true,
    canUseObsidian: true,
    canUsePrivateInference: false,
    canUseSso: false,
    canUseCustomDomain: false,
    hasPriorityProcessing: false,
    maxConnectedSources: 8,
    maxBriefingsPerDay: 3,
    maxPeopleRecords: 500,
    maxAutomations: 10,
    maxKnowledgeBaseStorageMb: 5_000,
    maxFileUploadsPerMonth: 500,
    maxDiaryEntriesPerMonth: null,
    monthlyAiTokenAllowance: 5_000_000,
    dataRetentionDays: 365,
    byoAgentSlots: 1,
    monitoringFrequency: "hourly",
    supportLevel: "priority",
    adminControlsLevel: "standard",
    availableSyncFrequencies: ALL_SYNC_FREQUENCIES,
  },

  plan_command: {
    planKey: "plan_command",
    status: "active",
    canCreateActions: true,
    canUseFollowUpNotifications: true,
    canUseCustomSchedules: true,
    canUseRealtimeMonitoring: true,
    canUseAdvancedPeopleCorrelation: true,
    canCustomisePrompts: true,
    canUsePromptVersioning: true,
    canUsePromptAuditTrail: true,
    canUseBYOAgent: true,
    canUseBYOApiKeys: true,
    canUseCustomModels: true,
    canUseMcpTools: true,
    canMonitorWhatsApp: true,
    canMonitorEmail: true,
    canMonitorTeams: true,
    canMonitorGitHub: true,
    canUseObsidian: true,
    canUsePrivateInference: false,
    canUseSso: false,
    canUseCustomDomain: false,
    hasPriorityProcessing: true,
    maxConnectedSources: 20,
    maxBriefingsPerDay: 10,
    maxPeopleRecords: 5_000,
    maxAutomations: 50,
    maxKnowledgeBaseStorageMb: 50_000,
    maxFileUploadsPerMonth: 5_000,
    maxDiaryEntriesPerMonth: null,
    monthlyAiTokenAllowance: 20_000_000,
    dataRetentionDays: 730,
    byoAgentSlots: 3,
    monitoringFrequency: "near_real_time",
    supportLevel: "priority",
    adminControlsLevel: "advanced",
    availableSyncFrequencies: ALL_SYNC_FREQUENCIES,
  },

  plan_enterprise: {
    planKey: "plan_enterprise",
    status: "active",
    canCreateActions: true,
    canUseFollowUpNotifications: true,
    canUseCustomSchedules: true,
    canUseRealtimeMonitoring: true,
    canUseAdvancedPeopleCorrelation: true,
    canCustomisePrompts: true,
    canUsePromptVersioning: true,
    canUsePromptAuditTrail: true,
    canUseBYOAgent: true,
    canUseBYOApiKeys: true,
    canUseCustomModels: true,
    canUseMcpTools: true,
    canMonitorWhatsApp: true,
    canMonitorEmail: true,
    canMonitorTeams: true,
    canMonitorGitHub: true,
    canUseObsidian: true,
    canUsePrivateInference: true,
    canUseSso: true,
    canUseCustomDomain: true,
    hasPriorityProcessing: true,
    maxConnectedSources: null,
    maxBriefingsPerDay: null,
    maxPeopleRecords: null,
    maxAutomations: null,
    maxKnowledgeBaseStorageMb: null,
    maxFileUploadsPerMonth: null,
    maxDiaryEntriesPerMonth: null,
    monthlyAiTokenAllowance: null,
    dataRetentionDays: null,
    byoAgentSlots: null,
    monitoringFrequency: "real_time",
    supportLevel: "dedicated",
    adminControlsLevel: "advanced_plus",
    availableSyncFrequencies: ALL_SYNC_FREQUENCIES,
  },
};

/**
 * The collapsed entitlement set for a tenant with NO usable subscription
 * (missing row, suspended, or expired). Identity/export remain available
 * elsewhere; this object grants no product capability and zero quota. The
 * resolver overlays the real `status` and `planKey`.
 */
export const LOCKED_BASELINE: Entitlements = {
  planKey: "plan_operator",
  status: "expired",
  canCreateActions: false,
  canUseFollowUpNotifications: false,
  canUseCustomSchedules: false,
  canUseRealtimeMonitoring: false,
  canUseAdvancedPeopleCorrelation: false,
  canCustomisePrompts: false,
  canUsePromptVersioning: false,
  canUsePromptAuditTrail: false,
  canUseBYOAgent: false,
  canUseBYOApiKeys: false,
  canUseCustomModels: false,
  canUseMcpTools: false,
  canMonitorWhatsApp: false,
  canMonitorEmail: false,
  canMonitorTeams: false,
  canMonitorGitHub: false,
  canUseObsidian: false,
  canUsePrivateInference: false,
  canUseSso: false,
  canUseCustomDomain: false,
  hasPriorityProcessing: false,
  maxConnectedSources: 0,
  maxBriefingsPerDay: 0,
  maxPeopleRecords: 0,
  maxAutomations: 0,
  maxKnowledgeBaseStorageMb: 0,
  maxFileUploadsPerMonth: 0,
  maxDiaryEntriesPerMonth: 0,
  monthlyAiTokenAllowance: 0,
  dataRetentionDays: 0,
  byoAgentSlots: 0,
  monitoringFrequency: "scheduled_daily",
  supportLevel: "standard",
  adminControlsLevel: "basic",
  availableSyncFrequencies: ["daily"],
};

/** Ordering for upgrade/downgrade comparisons (mirrors subscription_plans.tier_rank). */
export const PLAN_RANK: Record<PlanKey, number> = {
  plan_operator: 10,
  plan_executive: 20,
  plan_command: 30,
  plan_enterprise: 40,
};

/** True when `a` is a strictly higher tier than `b`. */
export function isHigherTier(a: PlanKey, b: PlanKey): boolean {
  return PLAN_RANK[a] > PLAN_RANK[b];
}

/** Plan defaults for a key, with `status` overlaid. Never mutates the catalog. */
export function planEntitlements(planKey: PlanKey, status: SubscriptionStatus): Entitlements {
  return { ...PLAN_ENTITLEMENTS[planKey], status };
}
