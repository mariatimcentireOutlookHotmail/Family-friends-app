import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { usePerson } from "@/lib/people";
import { useMemorial, useSetMemorial, useTreeMemberNames, type Memorial } from "@/lib/stories";
import { everydayName } from "@/lib/trees";

const MAX_STEWARDS = 5;
// Tick-box symbols (not words, so nothing to translate).
const CHECKED = "☑";
const UNCHECKED = "☐";

/** Owners: make a deceased person's profile a memorial and choose stewards. */
export default function MemorialScreen() {
  const { t } = useTranslation("stories");
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = usePerson(id);
  const memorial = useMemorial(id);

  if (person.isPending || memorial.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }
  if (!person.data || person.data.myRole !== "owner" || person.data.living_status !== "deceased") {
    return (
      <View className="flex-1 bg-gray-50 p-6 dark:bg-black">
        <Text className="text-base text-gray-900 dark:text-gray-100">{t("page.notFound", { ns: "person" })}</Text>
      </View>
    );
  }

  return (
    <MemorialForm
      personId={id}
      treeId={person.data.tree_id}
      name={everydayName(person.data) ?? ""}
      initial={memorial.data ?? { on: false, stewards: [] }}
    />
  );
}

function MemorialForm({
  personId,
  treeId,
  name,
  initial,
}: {
  personId: string;
  treeId: string;
  name: string;
  initial: Memorial;
}) {
  const { t } = useTranslation("stories");
  const members = useTreeMemberNames(treeId);
  const setMemorial = useSetMemorial(personId);
  const [on, setOn] = useState(initial.on);
  const [stewards, setStewards] = useState<string[]>(initial.stewards);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (userId: string) =>
    setStewards((list) => (list.includes(userId) ? list.filter((x) => x !== userId) : [...list, userId]));

  const save = () => {
    setMessage(null);
    if (on && stewards.length > MAX_STEWARDS) {
      setMessage({ ok: false, text: t("memorial.tooMany") });
      return;
    }
    setMemorial.mutate(
      { on, stewards: on ? stewards : [] },
      {
        onSuccess: () => setMessage({ ok: true, text: t("memorial.saved") }),
        onError: (e) => {
          if (__DEV__) console.warn("[memorial error]", e);
          setMessage({ ok: false, text: t("memorial.failed") });
        },
      },
    );
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-black" contentContainerClassName="items-center p-6">
      <View className="w-full max-w-md gap-5">
        <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("memorial.title")}</Text>
        <Text className="text-base text-gray-700 dark:text-gray-300">{t("memorial.explain", { name })}</Text>

        <View className="flex-row items-center justify-between gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
          <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">{t("memorial.switch")}</Text>
          <Switch value={on} onValueChange={setOn} accessibilityLabel={t("memorial.switch")} />
        </View>

        {on ? (
          <View className="gap-2">
            <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{t("memorial.stewards")}</Text>
            <Text className="text-sm text-gray-600 dark:text-gray-400">{t("memorial.stewardsHint")}</Text>
            {(members.data ?? []).map((m) => {
              const selected = stewards.includes(m.user_id);
              const label = m.name ?? t("memorial.noName", { role: t(`memorial.role.${m.role}`) });
              return (
                <Pressable
                  key={m.user_id}
                  onPress={() => toggle(m.user_id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={label}
                  className={`min-h-11 flex-row items-center gap-3 rounded-lg border px-3 ${
                    selected
                      ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                      : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                  }`}
                >
                  <Text className="text-base text-indigo-700 dark:text-indigo-300">{selected ? CHECKED : UNCHECKED}</Text>
                  <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">{label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {message ? (
          <Text className={`text-sm ${message.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {message.text}
          </Text>
        ) : null}
        <Button
          label={setMemorial.isPending ? t("memorial.saving") : t("memorial.save")}
          loading={setMemorial.isPending}
          onPress={save}
        />
      </View>
    </ScrollView>
  );
}
