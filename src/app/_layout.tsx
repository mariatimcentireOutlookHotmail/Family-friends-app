import "@/global.css";
import "@/i18n";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { loadSavedLanguage } from "@/i18n";

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
    <>
      <Stack>
        <Stack.Screen name="index" options={{ title: t("home.title") }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
