import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";

import { ConnectionStatus } from "@/components/ConnectionStatus";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function HomeScreen() {
  const { t, i18n } = useTranslation();

  // Dates are formatted with Intl for the current UI language,
  // e.g. "November 19, 2026" / "19 November 2026" / "2026年11月19日".
  const today = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "long",
  }).format(new Date());

  return (
    <ScrollView
      className="flex-1 bg-gray-50 dark:bg-black"
      contentContainerClassName="items-center p-6"
    >
      <View className="w-full max-w-md gap-6">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {t("home.welcome")}
          </Text>
          <Text className="text-base text-gray-700 dark:text-gray-300">
            {t("home.tagline")}
          </Text>
        </View>

        {/* Sample ICU plural and Intl date, to show formatting per language */}
        <View className="gap-1 rounded-xl bg-white p-4 dark:bg-gray-900">
          <Text className="text-base text-gray-900 dark:text-gray-100">
            {t("home.relativeCount", { count: 1 })}
          </Text>
          <Text className="text-base text-gray-900 dark:text-gray-100">
            {t("home.relativeCount", { count: 12 })}
          </Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400">
            {t("home.today", { date: today })}
          </Text>
        </View>

        <ConnectionStatus />

        <LanguageSwitcher />
      </View>
    </ScrollView>
  );
}
