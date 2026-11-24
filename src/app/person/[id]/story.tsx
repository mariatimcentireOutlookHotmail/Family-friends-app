import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { TextField } from "@/components/ui/TextField";
import { LANGUAGE_AUTONYMS, SUPPORTED_LANGUAGES, isSupportedLanguage, type Language } from "@/i18n/languages";
import { useAuth } from "@/lib/auth";
import { usePerson } from "@/lib/people";
import { useMemorial, useSaveStory, useStories, type Story } from "@/lib/stories";
import { everydayName } from "@/lib/trees";

/** Write a new story about a person, or edit one (?story=id). */
export default function StoryScreen() {
  const { t } = useTranslation("stories");
  const { id, story: storyId } = useLocalSearchParams<{ id: string; story?: string }>();
  const person = usePerson(id);
  const stories = useStories(id);
  const memorial = useMemorial(id);

  if (person.isPending || stories.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }
  if (!person.data) {
    return (
      <View className="flex-1 bg-gray-50 p-6 dark:bg-black">
        <Text className="text-base text-gray-900 dark:text-gray-100">{t("page.notFound", { ns: "person" })}</Text>
      </View>
    );
  }
  const existing = storyId ? stories.data?.find((s) => s.id === storyId) : undefined;
  return (
    <StoryForm
      personId={id}
      treeId={person.data.tree_id}
      name={everydayName(person.data) ?? ""}
      memorial={Boolean(memorial.data?.on) && person.data.living_status === "deceased"}
      existing={existing}
    />
  );
}

function StoryForm({
  personId,
  treeId,
  name,
  memorial,
  existing,
}: {
  personId: string;
  treeId: string;
  name: string;
  memorial: boolean;
  existing: Story | undefined;
}) {
  const { t, i18n } = useTranslation("stories");
  const { session } = useAuth();
  const save = useSaveStory();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [lang, setLang] = useState<Language>(
    existing?.lang ?? (isSupportedLanguage(i18n.language) ? i18n.language : "en"),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!body.trim()) {
      setError(t("screen.needBody"));
      return;
    }
    save.mutate(
      { id: existing?.id, personId, treeId, title, body, lang, author: session?.user.id },
      {
        onSuccess: () => (router.canGoBack() ? router.back() : router.replace("/")),
        onError: (e) => {
          if (__DEV__) console.warn("[story error]", e);
          setError(t("screen.failed"));
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-gray-50 dark:bg-black">
      <ScrollView contentContainerClassName="items-center p-6" keyboardShouldPersistTaps="handled">
        <View className="w-full max-w-md gap-5">
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {memorial ? t("screen.headingMemorial", { name }) : t("screen.heading", { name })}
          </Text>
          <TextField
            label={t("screen.titleLabel")}
            value={title}
            onChangeText={setTitle}
            placeholder={t("screen.titleHint")}
            maxLength={120}
          />
          <TextField
            label={t("screen.bodyLabel")}
            value={body}
            onChangeText={setBody}
            placeholder={t("screen.bodyHint")}
            multiline
            maxLength={10000}
            inputClassName="min-h-48"
            textAlignVertical="top"
          />
          <View className="gap-1.5">
            <ChoiceChips
              label={t("screen.langLabel")}
              value={lang}
              onChange={setLang}
              options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_AUTONYMS[l] }))}
            />
            <Text className="text-xs text-gray-500">{t("screen.langNote")}</Text>
          </View>
          {error ? (
            <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </Text>
          ) : null}
          <Button label={save.isPending ? t("screen.saving") : t("screen.save")} loading={save.isPending} onPress={submit} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
