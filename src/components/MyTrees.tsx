import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Text, View } from "react-native";

import { TreeCard } from "@/components/TreeCard";
import { Button } from "@/components/ui/Button";
import { useMyTrees } from "@/lib/trees";

/** The signed-in user's trees, or a prompt to create the first one. */
export function MyTrees() {
  const { t } = useTranslation("tree");
  const trees = useMyTrees();

  if (trees.isPending) return <ActivityIndicator />;

  if (trees.isError) {
    return (
      <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
        <Text className="text-base text-red-600 dark:text-red-400">{t("home.loadError")}</Text>
        <Button variant="secondary" label={t("home.retry")} onPress={() => void trees.refetch()} />
      </View>
    );
  }

  if (trees.data.length === 0) {
    return (
      <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
        <Text className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("home.noTreeTitle")}</Text>
        <Text className="text-base text-gray-700 dark:text-gray-300">{t("home.noTreeBody")}</Text>
        <Button label={t("home.createButton")} onPress={() => router.push("/create-tree")} />
      </View>
    );
  }

  return (
    <>
      {trees.data.map((tree) => (
        <TreeCard key={tree.id} tree={tree} />
      ))}
    </>
  );
}
