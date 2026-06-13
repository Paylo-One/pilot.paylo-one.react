import type { Session } from "@management-os/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { secureSessionStorage } from "./secure-session-storage";

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  setSession(session: Session): Promise<void>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    secureSessionStorage
      .get()
      .then((stored) => {
        if (active) setSessionState(stored);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setSession = useCallback(async (next: Session) => {
    await secureSessionStorage.set(next);
    setSessionState(next);
  }, []);

  const logout = useCallback(async () => {
    await secureSessionStorage.clear();
    setSessionState(null);
  }, []);

  const value = useMemo(
    () => ({ session, loading, setSession, logout }),
    [loading, logout, session, setSession],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider.");
  }
  return value;
}
