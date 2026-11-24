import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { TreeCanvas, type CardInfo, type TreeCanvasHandle } from "@/components/TreeCanvas";
import { useAuth } from "@/lib/auth";
import { useProfilePhotos } from "@/lib/photos";
import { layoutTree, type LayoutMode } from "@/lib/treeLayout";
import { everydayName, knownAs, lifeYears, primaryName, useMyTrees } from "@/lib/trees";
import { useKinship } from "@/lib/useKinship";

const MIN_GENERATIONS = 1;
const MAX_GENERATIONS = 5;
const MODES: LayoutMode[] = ["family", "ancestors", "descendants"];

/**
 * The interactive family tree. Opens centred on `focus` (or on you).
 * The list and card views on the home screen stay as the simple fallback.
 */
export default function TreeScreen() {
  const { t } = useTranslation("treeView");
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const { session } = useAuth();
  const query = useMyTrees();
  const tree = query.data?.find((x) => x.id === id);
  const kinship = useKinship(tree);
  const canvas = useRef<TreeCanvasHandle>(null);
  const photos = useProfilePhotos(id);

  const me = tree?.persons.find((p) => p.claimed_by_user_id === session?.user.id)?.id ?? null;
  const [chosenFocus, setChosenFocus] = useState<string | null>(focus ?? null);
  const focusId =
    (chosenFocus && tree?.persons.some((p) => p.id === chosenFocus) ? chosenFocus : null) ??
    me ??
    tree?.persons[0]?.id ??
    null;

  const [mode, setMode] = useState<LayoutMode>("family");
  const [generations, setGenerations] = useState(3);
  const [showFriends, setShowFriends] = useState(false);

  const layout = useMemo(() => {
    if (!tree || !focusId) return null;
    const people = tree.persons.map((p) => ({
      id: p.id,
      sex: p.sex,
      birthYear: p.events?.find((e) => e.type === "birth")?.year ?? null,
    }));
    return layoutTree(people, tree.relationships ?? [], focusId, { mode, generations, showFriends });
  }, [tree, focusId, mode, generations, showFriends]);

  const cardInfo = useCallback(
    (personId: string): CardInfo => {
      const person = tree?.persons.find((p) => p.id === personId);
      const label = kinship.get(personId);
      return {
        // Nickname or "also known as" name first (that's how family knows
        // them), with the full name below.
        name: (person && everydayName(person)) ?? t("minor.name", { ns: "privacy" }),
        photo: photos.data?.get(personId) ?? null,
        relation: personId === me ? t("you") : (label?.term ?? label?.description ?? null),
        years:
          [person && knownAs(person) ? primaryName(person) : null, person ? lifeYears(person) : null]
            .filter(Boolean)
            .join(" · ") || null,
      };
    },
    [tree, kinship, me, t, photos.data],
  );

  if (query.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-950">
        <ActivityIndicator />
      </View>
    );
  }
  if (!tree) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-6 dark:bg-gray-950">
        <Text className="text-gray-700 dark:text-gray-300">{t("notFound")}</Text>
      </View>
    );
  }
  if (!layout) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-6 dark:bg-gray-950">
        <Text className="text-gray-700 dark:text-gray-300">{t("empty")}</Text>
      </View>
    );
  }

  const changeGenerations = (delta: number) =>
    setGenerations((g) => Math.max(MIN_GENERATIONS, Math.min(MAX_GENERATIONS, g + delta)));

  return (
    <View className="flex-1 bg-white dark:bg-gray-950">
      {/* One slim row of controls, so the tree gets the room. Scrolls
          sideways on narrow phones. */}
      <View className="border-b border-gray-200 dark:border-gray-800">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="items-center gap-3 px-3 py-2">
          <View accessibilityRole="radiogroup" className="flex-row rounded-full border border-gray-300 p-0.5 dark:border-gray-700">
            {MODES.map((value) => {
              const selected = mode === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setMode(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  className={`min-h-8 justify-center rounded-full px-3 ${selected ? "bg-indigo-600 dark:bg-indigo-500" : ""}`}
                >
                  <Text
                    className={`text-sm ${selected ? "font-semibold text-white" : "text-gray-800 dark:text-gray-200"}`}
                  >
                    {t(`view.${value}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="flex-row items-center gap-1">
            <SmallButton
              compact
              label="−"
              accessibilityLabel={t("generations.fewer")}
              disabled={generations <= MIN_GENERATIONS}
              onPress={() => changeGenerations(-1)}
            />
            <Text className="px-1 text-center text-sm text-gray-800 dark:text-gray-200">
              {t("generations.value", { count: generations })}
            </Text>
            <SmallButton
              compact
              label="+"
              accessibilityLabel={t("generations.more")}
              disabled={generations >= MAX_GENERATIONS}
              onPress={() => changeGenerations(1)}
            />
          </View>

          <Pressable
            onPress={() => setShowFriends((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: showFriends }}
            className={`min-h-8 flex-row items-center gap-1.5 rounded-full border px-3 ${
              showFriends
                ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                : "border-gray-300 dark:border-gray-700"
            }`}
          >
            {/* A filled dot when on, an empty one when off. */}
            <View
              className={`h-2.5 w-2.5 rounded-full border ${
                showFriends ? "border-indigo-600 bg-indigo-600 dark:border-indigo-400 dark:bg-indigo-400" : "border-gray-400"
              }`}
            />
            <Text className="text-sm text-gray-800 dark:text-gray-200">{t("friends")}</Text>
          </Pressable>

          {me && focusId !== me ? (
            <SmallButton compact label={t("backToMe")} onPress={() => setChosenFocus(me)} />
          ) : null}
        </ScrollView>
      </View>

      <View className="flex-1">
        <TreeCanvas
          // A new focus or view starts centred again.
          key={`${focusId}-${mode}`}
          ref={canvas}
          layout={layout}
          cardInfo={cardInfo}
          onOpen={(personId) => router.push({ pathname: "/person/[id]", params: { id: personId } })}
          onRecentre={setChosenFocus}
        />

        <View className="absolute bottom-4 right-4 items-end gap-2">
          <SmallButton label="+" accessibilityLabel={t("zoomIn")} onPress={() => canvas.current?.zoomBy(1.25)} />
          <SmallButton label="−" accessibilityLabel={t("zoomOut")} onPress={() => canvas.current?.zoomBy(0.8)} />
          <SmallButton label={t("fit")} onPress={() => canvas.current?.fit()} />
        </View>
      </View>

      <Text className="border-t border-gray-200 p-2 text-center text-xs text-gray-500 dark:border-gray-800">
        {t("hint")}
      </Text>
    </View>
  );
}

function SmallButton({
  label,
  accessibilityLabel,
  disabled,
  compact,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** Smaller, for the controls row. */
  compact?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      className={`${compact ? "min-h-8 min-w-8 px-2" : "min-h-10 min-w-10 px-3 shadow-sm"} items-center justify-center rounded-full border border-gray-300 bg-white active:opacity-70 dark:border-gray-700 dark:bg-gray-900 ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <Text className="text-base font-medium text-gray-900 dark:text-gray-100">{label}</Text>
    </Pressable>
  );
}
