import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { syncLanguageWithProfile } from "./profile";
import { supabase } from "./supabase";

type AuthState = {
  session: Session | null;
  /** True until the saved session (if any) has been loaded at startup. */
  isLoading: boolean;
};

const AuthContext = createContext<AuthState>({ session: null, isLoading: true });

/** Keeps track of who is signed in. Wrap the whole app in this once. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, isLoading: true });

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, isLoading: false });

      if (session && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
        // Supabase advises against calling Supabase directly inside this
        // callback (it can deadlock), so run it just after.
        setTimeout(() => void syncLanguageWithProfile(session.user.id), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
