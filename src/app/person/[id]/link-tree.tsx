import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, Share, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { LANGUAGE_AUTONYMS, SUPPORTED_LANGUAGES, isSupportedLanguage, type Language } from "@/i18n/languages";
import { inviteErrorKey } from "@/lib/invites";
import { linkErrorKey, useCreateLinkCode } from "@/lib/treeLinks";
import { usePerson, type PersonDetails } from "@/lib/people";
import { primaryName, useMyTrees } from "@/lib/trees";
import { joinLink } from "@/lib/joinLinks";

/** An owner makes a code to link this person with another family's tree. */
export default function LinkTreeScreen() {
  const { t } = useTranslation("links");
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePerson(id);

  if (query.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }
  if (!query.data || query.data.myRole !== "owner" || query.data.my_access?.isMinor) {
    return (
      <View className="flex-1 bg-gray-50 p-6 dark:bg-black">
        <Text className="text-base text-gray-900 dark:text-gray-100">{t("page.notFound", { ns: "person" })}</Text>
      </View>
    );
  }
  return <LinkForm person={query.data} />;
}

function LinkForm({ person }: { person: PersonDetails }) {
  const { t, i18n } = useTranslation("links");
  const trees = useMyTrees();
  const treeName = trees.data?.find((x) => x.id === person.tree_id)?.name ?? "";
  const name = primaryName(person) ?? "";
  const [lang, setLang] = useState<Language>(isSupportedLanguage(i18n.language) ? i18n.language : "en");
  const create = useCreateLinkCode(person.id);
  const [shareFailed, setShareFailed] = useState(false);

  const code = create.data;
  // The message is written in the language chosen for it, not the app's language.
  const message = code ? i18n.getFixedT(lang, "links")("message", { name, tree: treeName, code, link: joinLink(code) }) : "";

  const share = async () => {
    try {
      await Share.share({ message });
    } catch {
      setShareFailed(true);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-black" contentContainerClassName="items-center p-6">
      <View className="w-full max-w-md gap-5">
        <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("screen.heading", { name })}</Text>
        <Text className="text-base text-gray-700 dark:text-gray-300">{t("screen.intro", { name })}</Text>

        {!code ? (
          <>
            <ChoiceChips
              label={t("screen.langLabel")}
              value={lang}
              onChange={setLang}
              options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_AUTONYMS[l] }))}
            />
            <Button
              label={create.isPending ? t("screen.creating") : t("screen.create")}
              loading={create.isPending}
              onPress={() => create.mutate(lang)}
            />
            {create.isError ? (
              <Text className="text-sm text-red-600 dark:text-red-400">
                {linkErrorKey(create.error)
                  ? t(`errors.${linkErrorKey(create.error)!}`)
                  : t(`errors.${inviteErrorKey(create.error)}`, { ns: "invite" })}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <View className="items-center gap-2 rounded-xl bg-white p-5 dark:bg-gray-900">
              <Text className="text-sm font-medium text-gray-600 dark:text-gray-400">{t("screen.codeLabel")}</Text>
              <Text
                selectable
                accessibilityLabel={`${t("screen.codeLabel")}: ${code.split("").join(" ")}`}
                className="font-mono text-3xl font-bold tracking-widest text-indigo-700 dark:text-indigo-300"
              >
                {code}
              </Text>
            </View>
            <Text className="text-sm text-gray-700 dark:text-gray-300">{t("screen.codeNote")}</Text>
            <Button label={t("screen.share")} onPress={() => void share()} />
            {shareFailed ? (
              <Text className="text-sm text-gray-700 dark:text-gray-300">{t("screen.shareFailed")}</Text>
            ) : null}
            <View className="gap-1.5">
              <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{t("screen.messageLabel")}</Text>
              <Text
                selectable
                className="rounded-xl border border-gray-300 bg-white p-3 text-base text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                {message}
              </Text>
            </View>
            <Button
              variant="secondary"
              label={t("screen.done")}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}
