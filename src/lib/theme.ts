import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

import { colorScheme as nwColorScheme, useColorScheme } from "nativewind";

import { PALETTE_COLORS, isPaletteName, type Palette, type PaletteName } from "./palettes";

/**
 * Light / dark appearance, and the colour theme. "system" follows the phone or computer setting.
 * Saved on this device (a phone may be set to dark while a laptop isn't).
 * NativeWind switches every `dark:` class; tailwind.config.js uses
 * darkMode: "class" so this also works on the web.
 */
export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

const STORAGE_KEY = "theme";

const isThemeChoice = (v: unknown): v is ThemeChoice =>
  typeof v === "string" && (THEME_CHOICES as readonly string[]).includes(v);

let current: ThemeChoice = "system";

/**
 * Apply a choice. "Automatic" is resolved here from the device setting (and
 * kept in step with it), because with darkMode: "class" the web doesn't
 * follow the system on its own.
 */
function apply(choice: ThemeChoice) {
  current = choice;
  nwColorScheme.set(choice === "system" ? (Appearance.getColorScheme() ?? "light") : choice);
}

Appearance.addChangeListener(() => {
  if (current === "system") apply("system");
});

export async function getSavedTheme(): Promise<ThemeChoice> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    return isThemeChoice(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

/** Apply the saved theme and colours; call once before the first screen renders. */
export async function loadSavedTheme(): Promise<void> {
  apply(await getSavedTheme());
  setPaletteState(await getSavedPalette());
}

export async function setTheme(choice: ThemeChoice): Promise<void> {
  apply(choice);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not saved; still applied for now.
  }
}

// -----------------------------------------------------------------------------
// Colour theme (palette), also saved per device. The root layout reads it with
// usePalette() and sets the CSS variables from src/lib/palettes.ts.
// -----------------------------------------------------------------------------
const PALETTE_KEY = "palette";
let palette: PaletteName = "indigo";
const listeners = new Set<() => void>();

function setPaletteState(next: PaletteName) {
  palette = next;
  listeners.forEach((l) => l());
}

export async function getSavedPalette(): Promise<PaletteName> {
  try {
    const saved = await AsyncStorage.getItem(PALETTE_KEY);
    return isPaletteName(saved) ? saved : "indigo";
  } catch {
    return "indigo";
  }
}

export async function setPalette(next: PaletteName): Promise<void> {
  setPaletteState(next);
  try {
    await AsyncStorage.setItem(PALETTE_KEY, next);
  } catch {
    // Not saved; still applied for now.
  }
}

export function usePalette(): PaletteName {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => palette,
    () => palette,
  );
}

/** The current palette's colours, for places that can't use classes (SVG, placeholders). */
export function usePaletteColors(): Palette & { dark: boolean } {
  const name = usePalette();
  const { colorScheme } = useColorScheme();
  return { ...PALETTE_COLORS[name], dark: colorScheme === "dark" };
}
