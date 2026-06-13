import type { Session, SessionStorage } from "@management-os/auth";
import { sessionSchema } from "@management-os/auth";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_KEY = "management-os.session.v1";
let webSession: Session | null = null;

export const secureSessionStorage: SessionStorage = {
  async get() {
    if (Platform.OS === "web") return webSession;
    const stored = await SecureStore.getItemAsync(SESSION_KEY);
    if (!stored) return null;
    let value: unknown;
    try {
      value = JSON.parse(stored);
    } catch {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
    const parsed = sessionSchema.safeParse(value);
    if (!parsed.success) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
    return parsed.data;
  },
  async set(session) {
    if (Platform.OS === "web") {
      webSession = session;
      return;
    }
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },
  async clear() {
    if (Platform.OS === "web") {
      webSession = null;
      return;
    }
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};
