import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { useAuth } from "@/lib/auth";
import {
  useSetPrivacy,
  usePerson,
  type PersonDetails,
  type PrivacyField,
  type PrivacyLevel,
} from "@/lib/people";
import { primaryName } from "@/lib/trees";

const LEVELS: PrivacyLevel[] = ["private", "immediate", "tree"];

export default function PrivacyScreen() {
  const { t } = useTranslation("privacy");
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePerson(id);

  if (query.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }
  if (!query.data?.my_access?.canChangePrivacy) {
    return (
      <View className="flex-1 bg-gray-50 p-6 dark:bg-black">
        <Text className="text-base text-gray-900 dark:text-gray-100">{t("page.notFound", { ns: "person" })}</Text>
      </View>
    );
  }
  return <PrivacyForm person={query.data} />;
}

function PrivacyForm({ person }: { person: PersonDetails }) {
  const { t } = useTranslation("privacy");
  const { session } = useAuth();
  const setPrivacy = useSetPrivacy();
  const name = primaryName(person) ?? "—";
  const isSelf = person.claimed_by_user_id === session?.user.id;
  const initial = person.my_access!.levels;
  const [levels, setLevels] = useState<Record<PrivacyField, PrivacyLevel>>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  // Dates of death only matter for people who have died.
  const fields: PrivacyField[] =
    person.living_status === "deceased" ? ["birth_date", "death_date", "contact"] : ["birth_date", "contact"];

  // "Private" means "only me" on your own profile; for an unclaimed profile it
  // means the tree's owners.
  const levelLabel = (level: PrivacyLevel) =>
    level !== "private"
      ? t(`levels.${level}`)
      : isSelf
        ? t("levels.privateSelf")
        : person.claimed_by_user_id
          ? t("levels.private")
          : t("levels.privateUnclaimed");

  const save = async () => {
    setStatus("saving");
    try {
      for (const field of fields) {
        if (levels[field] !== initial[field]) {
          await setPrivacy.mutateAsync({ personId: person.id, field, level: levels[field] });
        }
      }
      setStatus("saved");
    } catch (error) {
      if (__DEV__) console.warn("[set privacy error]", error);
      setStatus("failed");
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-black" contentContainerClassName="items-center p-6">
      <View className="w-full max-w-md gap-6">
        <View className="gap-2">
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("screen.heading", { name })}</Text>
          <Text className="text-base text-gray-700 dark:text-gray-300">{t("screen.intro")}</Text>
        </View>

        {fields.map((field) => (
          <View key={field} className="rounded-xl bg-white p-4 dark:bg-gray-900">
            <ChoiceChips
              label={t(`fields.${field}`)}
              value={levels[field]}
              onChange={(level) => {
                setLevels((l) => ({ ...l, [field]: level }));
                setStatus("idle");
              }}
              options={LEVELS.map((level) => ({ value: level, label: levelLabel(level) }))}
            />
          </View>
        ))}

        <Text className="text-sm text-gray-600 dark:text-gray-400">{t("screen.yearNote")}</Text>

        {status === "saved" ? (
          <Text accessibilityRole="alert" className="text-sm text-green-700 dark:text-green-400">
            {t("screen.saved")}
          </Text>
        ) : status === "failed" ? (
          <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
            {t("screen.failed")}
          </Text>
        ) : null}

        <Button
          label={status === "saving" ? t("screen.saving") : t("screen.save")}
          onPress={() => void save()}
          loading={status === "saving"}
        />
      </View>
    </ScrollView>
  );
}
