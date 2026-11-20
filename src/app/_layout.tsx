import "@/global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Importing @/i18n also sets up i18next before any screen renders.
import { loadSavedLanguage } from "@/i18n";

// One cache for all server data (TanStack Query).
const queryClient = new QueryClient();

export default function RootLayout() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Apply the saved language before the first screen renders, so the UI
    // doesn't flash in the device language first.
    loadSavedLanguage().finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <Stack>
        <Stack.Screen name="index" options={{ title: t("home.title") }} />
      </Stack>
      <StatusBar style="auto" />
    </QueryClientProvider>
  );
}
