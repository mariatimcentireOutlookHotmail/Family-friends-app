import "@/global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Importing @/i18n also sets up i18next before any screen renders.
import { loadSavedLanguage } from "@/i18n";
import { AuthProvider, useAuth } from "@/lib/auth";

// One cache for all server data (TanStack Query).
const queryClient = new QueryClient();

export default function RootLayout() {
  const [languageReady, setLanguageReady] = useState(false);

  useEffect(() => {
    // Apply the saved language before the first screen renders, so the UI
    // doesn't flash in the device language first.
    loadSavedLanguage().finally(() => setLanguageReady(true));
  }, []);

  if (!languageReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
      <StatusBar style="auto" />
    </QueryClientProvider>
  );
}

/**
 * Signed-in people see the app; signed-out people see only the sign-in
 * screens. Expo Router redirects automatically when this changes.
 */
function RootNavigator() {
  const { t } = useTranslation();
  const { session, isLoading } = useAuth();

  // Wait until we know whether someone is signed in (the splash screen stays up).
  if (isLoading) return null;

  const signedIn = Boolean(session);

  return (
    <Stack>
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="index" options={{ title: t("home.title") }} />
        <Stack.Screen name="create-tree" options={{ title: t("create.title", { ns: "tree" }) }} />
      </Stack.Protected>

      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="sign-in" options={{ title: t("signIn.title", { ns: "auth" }) }} />
        <Stack.Screen name="verify" options={{ title: t("verify.title", { ns: "auth" }) }} />
      </Stack.Protected>
    </Stack>
  );
}
