import { createApiClient } from "@management-os/api-client";
import { createPublicAppConfig } from "@management-os/config";
import { Platform } from "react-native";

import { secureSessionStorage } from "@/auth/secure-session-storage";

export const appConfig = createPublicAppConfig({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  platform:
    Platform.OS === "ios"
      ? "ios"
      : Platform.OS === "android"
        ? "android"
        : "web",
});

export const apiConfigured = appConfig.apiBaseUrl.length > 0;

export const api = createApiClient({
  baseUrl: appConfig.apiBaseUrl,
  async getTokens() {
    return (await secureSessionStorage.get())?.tokens ?? null;
  },
  async getTenantId() {
    return (await secureSessionStorage.get())?.tenantId ?? null;
  },
});
