import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { undoErrorKey, useHistory, useUndoChange } from "@/lib/history";
import { namesFromSnapshots, summarize, type HistoryGroup, type Line } from "@/lib/historySummary";
import { everydayName, useMyTrees } from "@/lib/trees";

/**
 * History of a whole tree, or of one person (?person=id). Owners can undo.
 */
export default function HistoryScreen() {
  const { t, i18n } = useTranslation("history");
  const { treeId, person } = useLocalSearchParams<{ treeId: string; person?: string }>();
  const personId = person ?? null;
  const { session } = useAuth();
  const trees = useMyTrees();
  const tree = trees.data?.find((x) => x.id === treeId);
  const history = useHistory(treeId, personId);
  const undo = useUndoChange(treeId);
  const [undoError, setUndoError] = useState<{ txid: number; message: string } | null>(null);

  const groups = useMemo(() => history.data?.pages.flat() ?? [], [history.data]);
  const deletedNames = useMemo(() => namesFromSnapshots(groups), [groups]);

  const nameOf = (id: string | null | undefined): string => {
    if (!id) return t("someone");
    const p = tree?.persons.find((x) => x.id === id);
    if (p) return everydayName(p) ?? t("minor.name", { ns: "privacy" });
    return deletedNames.get(id) ?? t("someone");
  };

  /** Turn a line's raw values (codes like "female") into words. */
  const render = (line: Line): string => {
    const v = { ...line.values };
    const word = (ns: string, key: string, raw: string) => (raw ? t(key as never, { ns, defaultValue: raw }) : t("none"));
    if (line.key === "sexChanged") {
      v.from = word("tree", `sex.${v.from}`, v.from!);
      v.to = word("tree", `sex.${v.to}`, v.to!);
    } else if (line.key === "livingChanged") {
      v.from = word("person", `living.${v.from}`, v.from!);
      v.to = word("person", `living.${v.to}`, v.to!);
    } else if (line.key === "countryChanged") {
      v.from = word("privacy", `country.${v.from}`, v.from!);
      v.to = word("privacy", `country.${v.to}`, v.to!);
    } else if (line.key === "birthOrderChanged") {
      v.from = v.from || t("none");
      v.to = v.to || t("none");
    }
    if (v.event) v.event = t(`event.${v.event}` as never, { defaultValue: v.event });
    if (v.kind) v.kind = t(`kind.${v.kind}` as never, { defaultValue: v.kind });
    // The values differ per line, so check the key and pass the values as-is.
    const key: `lines.${Line["key"]}` = `lines.${line.key}`;
    return (t as unknown as (k: string, values: Record<string, string>) => string)(key, v);
  };

  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const who = (g: HistoryGroup) =>
    g.actorId && g.actorId === session?.user.id ? t("you") : (g.actorName ?? t("someone"));

  const heading = personId ? t("personHeading", { name: nameOf(personId) }) : t("treeHeading", { tree: tree?.name ?? "" });

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-black" contentContainerClassName="items-center p-6">
      <View className="w-full max-w-md gap-4">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{heading}</Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400">{t("ownersNote")}</Text>
        </View>

        {history.isPending ? <ActivityIndicator /> : null}
        {history.isError ? (
          <View className="gap-2">
            <Text className="text-base text-red-600 dark:text-red-400">{t("loadError")}</Text>
            <Button variant="secondary" label={t("retry")} onPress={() => void history.refetch()} />
          </View>
        ) : null}
        {history.isSuccess && groups.length === 0 ? (
          <Text className="text-base text-gray-700 dark:text-gray-300">{t("empty")}</Text>
        ) : null}

        {groups.map((g) => {
          const lines = summarize(g, nameOf);
          if (lines.length === 0 && !g.undoOf) return null;
          const undone = Boolean(g.undoneAt);
          return (
            <View
              key={g.txid}
              className={`gap-2 rounded-xl bg-white p-4 dark:bg-gray-900 ${undone ? "opacity-60" : ""}`}
            >
              <View className="flex-row flex-wrap items-center gap-x-2">
                <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">{who(g)}</Text>
                <Text className="text-sm text-gray-500">{when(g.at)}</Text>
                {undone ? (
                  <Text className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    {t("undone")}
                  </Text>
                ) : null}
              </View>
              {g.undoOf ? <Text className="text-sm italic text-gray-600 dark:text-gray-400">{t("undoOf")}</Text> : null}
              {lines.map((line, i) => (
                <Text
                  key={`${line.key}-${i}`}
                  className={`text-base text-gray-800 dark:text-gray-200 ${undone ? "line-through" : ""}`}
                >
                  {render(line)}
                </Text>
              ))}
              {g.canUndo ? (
                <View className="items-start">
                  <Button
                    variant="secondary"
                    label={t("undo")}
                    loading={undo.isPending && undo.variables === g.txid}
                    onPress={() => {
                      setUndoError(null);
                      undo.mutate(g.txid, {
                        onError: (e) => setUndoError({ txid: g.txid, message: t(`errors.${undoErrorKey(e)}`) }),
                      });
                    }}
                  />
                </View>
              ) : null}
              {undoError?.txid === g.txid ? (
                <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
                  {undoError.message}
                </Text>
              ) : null}
            </View>
          );
        })}

        {history.hasNextPage ? (
          <Button
            variant="secondary"
            label={t("showMore")}
            loading={history.isFetchingNextPage}
            onPress={() => void history.fetchNextPage()}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}
