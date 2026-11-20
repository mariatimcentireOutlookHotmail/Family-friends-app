import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { useAuth } from "@/lib/auth";
import { primaryName, type Tree } from "@/lib/trees";

/** A family tree's name and the people in it (a simple list for now). */
export function TreeCard({ tree }: { tree: Tree }) {
  const { t } = useTranslation("tree");
  const { session } = useAuth();
  const people = tree.persons ?? [];

  return (
    <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
      <View className="gap-0.5">
        <Text className="text-xl font-bold text-gray-900 dark:text-gray-100">{tree.name}</Text>
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          {t("home.peopleCount", { count: people.length })}
        </Text>
      </View>

      {people.map((person) => {
        const isMe = person.claimed_by_user_id === session?.user.id;
        return (
          <View
            key={person.id}
            className="flex-row items-center gap-3 border-t border-gray-100 pt-3 dark:border-gray-800"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900">
              {/* First character of the name as a simple avatar */}
              <Text className="text-base font-semibold text-indigo-700 dark:text-indigo-200">
                {Array.from(primaryName(person) ?? "?")[0]}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-base text-gray-900 dark:text-gray-100">{primaryName(person) ?? "—"}</Text>
              {isMe ? (
                <Text className="text-sm text-indigo-700 dark:text-indigo-300">{t("home.you")}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
