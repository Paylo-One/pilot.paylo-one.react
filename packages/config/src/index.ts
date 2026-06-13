export type PlatformId = "web" | "ios" | "android";

export interface FeatureFlags {
  newsBriefing: boolean;
  diaryVoiceCapture: boolean;
  pushNotifications: boolean;
  tenantSelection: boolean;
}

export const defaultFeatureFlags: FeatureFlags = {
  newsBriefing: true,
  diaryVoiceCapture: false,
  pushNotifications: false,
  tenantSelection: false,
};

export const paginationDefaults = {
  pageSize: 25,
  maxPageSize: 100,
} as const;

export const briefingDefaults = {
  maxItems: 10,
  snoozeMinutes: 60,
  staleTimeMs: 60_000,
} as const;

export interface PublicAppConfig {
  apiBaseUrl: string;
  platform: PlatformId;
  featureFlags: FeatureFlags;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function createPublicAppConfig(input: {
  apiBaseUrl?: string;
  platform: PlatformId;
  featureFlags?: Partial<FeatureFlags>;
}): PublicAppConfig {
  return {
    apiBaseUrl: trimTrailingSlash(input.apiBaseUrl?.trim() ?? ""),
    platform: input.platform,
    featureFlags: { ...defaultFeatureFlags, ...input.featureFlags },
  };
}
