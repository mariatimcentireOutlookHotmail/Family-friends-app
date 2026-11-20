import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { useSupabaseStatus } from "@/lib/useSupabaseStatus";

const DOT_COLOR = {
  checking: "bg-gray-400",
  connected: "bg-green-500",
  notConfigured: "bg-amber-500",
  badKey: "bg-red-500",
  unreachable: "bg-red-500",
} as const;

/** Small developer-facing card showing whether the app can reach Supabase. */
export function ConnectionStatus() {
  const { t } = useTranslation("settings");
  const { data, isPending } = useSupabaseStatus();
  const status = isPending || !data ? "checking" : data;

  return (
    <View className="flex-row items-center gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
      <View className={`h-3 w-3 rounded-full ${DOT_COLOR[status]}`} />
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("connection.label")}
        </Text>
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          {t(`connection.${status}`)}
        </Text>
      </View>
    </View>
  );
}
