import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { PALETTES, PALETTE_COLORS, type PaletteName } from "@/lib/palettes";
import { THEME_CHOICES, getSavedTheme, setPalette, setTheme, usePalette, type ThemeChoice } from "@/lib/theme";

/** Appearance (Automatic / Light / Dark) and colour theme. */
export function ThemeSwitcher() {
  const { t } = useTranslation("settings");
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const palette = usePalette();

  useEffect(() => {
    void getSavedTheme().then(setChoice);
  }, []);

  return (
    <View className="gap-4">
      <ChoiceChips
        label={t("theme.label")}
        value={choice}
        onChange={(next) => {
          setChoice(next);
          void setTheme(next);
        }}
        options={THEME_CHOICES.map((c) => ({ value: c, label: t(`theme.${c}`) }))}
      />
      <View className="gap-1.5">
        <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{t("palette.label")}</Text>
        <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup" accessibilityLabel={t("palette.label")}>
          {PALETTES.map((name) => (
            <Swatch key={name} name={name} label={t(`palette.${name}`)} selected={palette === name} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** A circle showing the palette by day (left) and by night (right). */
function Swatch({ name, label, selected }: { name: PaletteName; label: string; selected: boolean }) {
  const p = PALETTE_COLORS[name];
  return (
    <Pressable
      onPress={() => void setPalette(name)}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      className="items-center gap-1"
    >
      <View
        className={`h-12 w-12 flex-row overflow-hidden rounded-full border-2 ${
          selected ? "border-indigo-600 dark:border-indigo-400" : "border-gray-300 dark:border-gray-700"
        }`}
      >
        <View style={{ flex: 1, backgroundColor: p.gray["100"], justifyContent: "center", alignItems: "flex-end" }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: p.accent["600"], marginRight: -7 }} />
        </View>
        <View style={{ flex: 1, backgroundColor: p.gray["900"] }} />
      </View>
      <Text
        className={`text-xs ${selected ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-gray-700 dark:text-gray-300"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
