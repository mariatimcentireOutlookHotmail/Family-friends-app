import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";

/**
 * A short, plain privacy note (from the project plan). Open to everyone,
 * signed in or not, so people can read it before signing up.
 */
export default function AboutPrivacyScreen() {
  const { t } = useTranslation("privacy");
  const paragraphs = ["note.body1", "note.body2", "note.body3", "note.body4", "note.body5"] as const;

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-black" contentContainerClassName="items-center p-6">
      <View className="w-full max-w-md gap-4">
        <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("note.title")}</Text>
        {paragraphs.map((key) => (
          <Text key={key} className="text-base leading-6 text-gray-800 dark:text-gray-200">
            {t(key)}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}
