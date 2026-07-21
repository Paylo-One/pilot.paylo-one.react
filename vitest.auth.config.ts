import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

/**
 * Coverage gate for the authentication foundation hardened in this batch.
 * Keeping the source allowlist explicit prevents unrelated, currently
 * untested product modules from diluting or inflating the auth result.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: true,
        provider: "v8",
        reporter: ["text", "json-summary"],
        include: [
          "app/(auth)/activate/**/actions.ts",
          "app/(auth)/onboarding/actions.ts",
          "app/(auth)/sign-in/notice.ts",
          "app/(auth)/sign-in/readable-error.ts",
          "app/auth/callback/route.ts",
          "app/auth/confirm/route.ts",
          "app/auth/signout/route.ts",
          "lib/auth-redirect.ts",
          "lib/tenant/host.ts",
          "modules/identity-tenant/server.ts",
        ],
        thresholds: {
          statements: 100,
          branches: 90,
          functions: 100,
          lines: 100,
        },
      },
    },
  }),
);
