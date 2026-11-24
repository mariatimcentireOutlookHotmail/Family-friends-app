import "@/global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from "expo-router";
import { useLinkingURL } from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { useColorScheme, vars } from "nativewind";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

// Importing @/i18n also sets up i18next before any screen renders.
import { loadSavedLanguage } from "@/i18n";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PALETTE_COLORS, paletteVars } from "@/lib/palettes";
import { rememberJoinFromUrl } from "@/lib/pendingJoin";
import { onReminderTapped } from "@/lib/reminders";
import { loadSavedTheme, usePalette } from "@/lib/theme";

// One cache for all server data (TanStack Query).
const queryClient = new QueryClient();

export default function RootLayout() {
  const [languageReady, setLanguageReady] = useState(false);

  useEffect(() => {
    // Apply the saved language and theme before the first screen renders, so the UI
    // doesn't flash in the device language first.
    Promise.all([loadSavedLanguage(), loadSavedTheme()]).finally(() => setLanguageReady(true));
  }, []);

  if (!languageReady) return null;

  return (
    // Needed for drag and pinch in the tree view.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemedNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Applies the colour theme (CSS variables used by every gray-/indigo- class)
 * and makes headers and the status bar follow it and the Appearance setting.
 */
/** Opens the person when a birthday reminder is tapped. */
function useReminderTaps() {
  useEffect(() => onReminderTapped((personId) => router.push({ pathname: "/person/[id]", params: { id: personId } })), []);
}

function ThemedNavigator() {
  useReminderTaps();
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  const palette = usePalette();
  const navTheme = useMemo(() => {
    const p = PALETTE_COLORS[palette];
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: dark ? p.accent["400"] : p.accent["600"],
        background: dark ? p.black : p.gray["50"],
        card: dark ? p.gray["900"] : p.white,
        text: dark ? p.gray["100"] : p.gray["900"],
        border: dark ? p.gray["800"] : p.gray["200"],
      },
    };
  }, [palette, dark]);
  return (
    <View style={[{ flex: 1 }, vars(paletteVars(palette))]}>
      <ThemeProvider value={navTheme}>
        <RootNavigator />
        <StatusBar style={dark ? "light" : "dark"} />
      </ThemeProvider>
    </View>
  );
}

/**
 * Signed-in people see the app; signed-out people see only the sign-in
 * screens. Expo Router redirects automatically when this changes.
 * Every screen must be listed in one of the two groups below: a screen not
 * listed here would be open to everyone. The only exception is the privacy
 * note (about-privacy), which is public on purpose.
 */
function RootNavigator() {
  const { t } = useTranslation();
  const { session, isLoading } = useAuth();
  const signedIn = Boolean(session);

  // An invite link opened while signed out: keep its code for after sign-in
  // (the home screen picks it up). See src/lib/pendingJoin.ts.
  const url = useLinkingURL();
  useEffect(() => {
    if (!isLoading && !signedIn) rememberJoinFromUrl(url);
  }, [url, isLoading, signedIn]);

  // Wait until we know whether someone is signed in (the splash screen stays up).
  if (isLoading) return null;

  return (
    <Stack>
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="index" options={{ title: t("home.title") }} />
        <Stack.Screen name="create-tree" options={{ title: t("create.title", { ns: "tree" }) }} />
        <Stack.Screen name="person/[id]/index" options={{ title: t("page.title", { ns: "person" }) }} />
        <Stack.Screen name="person/[id]/add-relative" options={{ title: t("add.title", { ns: "person" }) }} />
        <Stack.Screen name="person/[id]/edit" options={{ title: t("person.title", { ns: "edit" }) }} />
        <Stack.Screen name="link/[id]" options={{ title: t("link.title", { ns: "edit" }) }} />
        <Stack.Screen name="person/[id]/invite" options={{ title: t("screen.title", { ns: "invite" }) }} />
        <Stack.Screen name="history/[treeId]" options={{ title: t("title", { ns: "history" }) }} />
        <Stack.Screen name="person/[id]/link-tree" options={{ title: t("screen.title", { ns: "links" }) }} />
        <Stack.Screen name="photo/[id]" options={{ title: t("screenTitle", { ns: "photos" }) }} />
        <Stack.Screen name="person/[id]/story" options={{ title: t("screen.newTitle", { ns: "stories" }) }} />
        <Stack.Screen name="person/[id]/memorial" options={{ title: t("memorial.title", { ns: "stories" }) }} />
        <Stack.Screen name="join" options={{ title: t("join.title", { ns: "invite" }) }} />
        <Stack.Screen name="tree/[id]" options={{ title: t("title", { ns: "treeView" }) }} />
        <Stack.Screen name="person/[id]/privacy" options={{ title: t("screen.title", { ns: "privacy" }) }} />
      </Stack.Protected>

      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="sign-in" options={{ title: t("signIn.title", { ns: "auth" }) }} />
        <Stack.Screen name="verify" options={{ title: t("verify.title", { ns: "auth" }) }} />
      </Stack.Protected>

      {/* Deliberately public: people can read it before signing up. */}
      <Stack.Screen name="about-privacy" options={{ title: t("note.title", { ns: "privacy" }) }} />
    </Stack>
  );
}
