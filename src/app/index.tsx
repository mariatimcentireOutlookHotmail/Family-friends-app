import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";

import { AccountCard } from "@/components/AccountCard";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { MyTrees } from "@/components/MyTrees";
import { Button } from "@/components/ui/Button";

export default function HomeScreen() {
  const { t } = useTranslation();

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

        <MyTrees />

        <AccountCard />

        <LanguageSwitcher />

        <ConnectionStatus />

        <Button
          variant="link"
          label={t("note.link", { ns: "privacy" })}
          onPress={() => router.push("/about-privacy")}
        />
      </View>
    </ScrollView>
  );
}
