import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import i18n, { getSavedLanguage, setLanguage } from "@/i18n";
import {
  LANGUAGE_AUTONYMS,
  SUPPORTED_LANGUAGES,
  type Language,
} from "@/i18n/languages";
import { useAuth } from "@/lib/auth";
import { saveLanguageToProfile } from "@/lib/profile";

/** null = follow the device language. */
type Choice = Language | null;

export function LanguageSwitcher() {
  const { t } = useTranslation("settings");
  const { session } = useAuth();
  const [choice, setChoice] = useState<Choice>(null);

  useEffect(() => {
    const refresh = () => void getSavedLanguage().then(setChoice);
    refresh();
    // The language can also change elsewhere, e.g. from the account after sign-in.
    i18n.on("languageChanged", refresh);
    return () => i18n.off("languageChanged", refresh);
  }, []);

  const select = async (next: Choice) => {
    setChoice(next);
    await setLanguage(next);
    // Signed in: remember the choice on the account too, for other devices.
    if (session) await saveLanguageToProfile(session.user.id, next);
  };

  return (
    <View className="w-full gap-2" accessibilityRole="radiogroup">
      <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
        {t("language.label")}
      </Text>
      <Text className="text-sm text-gray-600 dark:text-gray-400">
        {t("language.hint")}
      </Text>

      <Option
        label={t("language.useDevice")}
        selected={choice === null}
        onPress={() => void select(null)}
      />
      {SUPPORTED_LANGUAGES.map((lng) => (
        <Option
          key={lng}
          label={LANGUAGE_AUTONYMS[lng]}
          selected={choice === lng}
          onPress={() => void select(lng)}
        />
      ))}
    </View>
  );
}

function Option({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={`flex-row items-center gap-3 rounded-xl border px-4 py-3 ${
        selected
          ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950"
          : "border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
      }`}
    >
      <View
        className={`h-5 w-5 items-center justify-center rounded-full border-2 ${
          selected ? "border-indigo-600" : "border-gray-400"
        }`}
      >
        {selected ? <View className="h-2.5 w-2.5 rounded-full bg-indigo-600" /> : null}
      </View>
      <Text className="text-base text-gray-900 dark:text-gray-100">
        {label}
      </Text>
    </Pressable>
  );
}
