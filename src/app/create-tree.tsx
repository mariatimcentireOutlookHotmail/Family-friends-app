import { router } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { DateField, checkDates } from "@/components/DateField";
import { NameEditor, draftsToNames, emptyName, type NameDraft } from "@/components/NameEditor";
import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { TextField } from "@/components/ui/TextField";
import { LANGUAGE_AUTONYMS, SUPPORTED_LANGUAGES, isSupportedLanguage, type Language } from "@/i18n/languages";
import { draftToDate, emptyDateDraft, toPayload, type DateDraft } from "@/lib/dates";
import { formatFullName } from "@/lib/names";
import { useCreateTree, type Sex } from "@/lib/trees";

const MAX_NAMES = 10;
const SEXES: Sex[] = ["female", "male", "other", "unknown"];

export default function CreateTreeScreen() {
  const { t, i18n } = useTranslation("tree");
  const createTree = useCreateTree();
  const nextKey = useRef(1);

  const [treeName, setTreeName] = useState("");
  const [treeLocale, setTreeLocale] = useState<Language>(
    isSupportedLanguage(i18n.language) ? i18n.language : "en",
  );
  const [names, setNames] = useState<NameDraft[]>([emptyName("name-0")]);
  const [sex, setSex] = useState<Sex>("unknown");
  const [birth, setBirth] = useState<DateDraft>(emptyDateDraft);
  const [birthError, setBirthError] = useState<string | null>(null);
  const [treeNameError, setTreeNameError] = useState<string | null>(null);
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const updateName = (index: number, next: NameDraft) => {
    setNames((list) => list.map((n, i) => (i === index ? next : n)));
    // Clear this name's error as soon as the user edits it.
    setNameErrors(({ [next.key]: _cleared, ...rest }) => rest);
  };

  const addName = () =>
    setNames((list) => [...list, emptyName(`name-${nextKey.current++}`, false)]);

  const removeName = (index: number) => setNames((list) => list.filter((_, i) => i !== index));

  const submit = () => {
    setFormError(null);
    const trimmedTreeName = treeName.trim();
    const missingNames: Record<string, string> = {};
    names.forEach((n) => {
      if (!formatFullName(n)) missingNames[n.key] = t("create.errors.nameRequired");
    });
    setTreeNameError(trimmedTreeName ? null : t("create.errors.treeNameRequired"));
    setNameErrors(missingNames);
    const dateErrors = checkDates(birth, null);
    setBirthError(dateErrors.birth ? t(`errors.${dateErrors.birth}`, { ns: "dates" }) : null);
    if (!trimmedTreeName || Object.keys(missingNames).length > 0 || dateErrors.birth) return;

    createTree.mutate(
      {
        treeName: trimmedTreeName,
        treeLocale,
        sex,
        names: draftsToNames(names),
        birth: toPayload(draftToDate(birth)),
      },
      {
        // Go back to the home screen we came from (or open it, if this
        // screen was opened directly, e.g. from a web address).
        onSuccess: () => (router.canGoBack() ? router.back() : router.replace("/")),
        onError: (error) => {
          if (__DEV__) console.warn("[create tree error]", error);
          setFormError(t("create.errors.failed"));
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-gray-50 dark:bg-black"
    >
      <ScrollView contentContainerClassName="items-center p-6" keyboardShouldPersistTaps="handled">
        <View className="w-full max-w-md gap-6">
          <View className="gap-2">
            <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {t("create.heading")}
            </Text>
            <Text className="text-base text-gray-700 dark:text-gray-300">{t("create.intro")}</Text>
          </View>

          <TextField
            label={t("create.treeNameLabel")}
            placeholder={t("create.treeNamePlaceholder")}
            value={treeName}
            onChangeText={(text) => {
              setTreeName(text);
              setTreeNameError(null);
            }}
            error={treeNameError}
            maxLength={200}
          />

          <View className="gap-1.5">
            <ChoiceChips
              label={t("create.treeLanguageLabel")}
              value={treeLocale}
              onChange={setTreeLocale}
              options={SUPPORTED_LANGUAGES.map((lng) => ({ value: lng, label: LANGUAGE_AUTONYMS[lng] }))}
            />
            <Text className="text-sm text-gray-600 dark:text-gray-400">{t("create.treeLanguageHint")}</Text>
          </View>

          <View className="gap-3">
            <Text className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("create.aboutYou")}</Text>
            <Text className="text-sm text-gray-600 dark:text-gray-400">{t("names.hint")}</Text>

            {names.map((name, index) => (
              <NameEditor
                key={name.key}
                value={name}
                isMain={index === 0}
                mainTitle={t("names.mainName")}
                autofillSelf
                onChange={(next) => updateName(index, next)}
                onRemove={index > 0 ? () => removeName(index) : undefined}
                error={nameErrors[name.key]}
              />
            ))}

            {names.length < MAX_NAMES ? (
              <Button variant="secondary" label={t("names.add")} onPress={addName} />
            ) : null}
          </View>

          <DateField
            label={t("fields.yourBirthLabel", { ns: "dates" })}
            value={birth}
            onChange={(next) => {
              setBirth(next);
              setBirthError(null);
            }}
            error={birthError}
            showHint
          />

          <ChoiceChips
            label={t("sex.label")}
            value={sex}
            onChange={setSex}
            options={SEXES.map((s) => ({ value: s, label: t(`sex.${s}`) }))}
          />

          {formError ? (
            <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
              {formError}
            </Text>
          ) : null}

          <Button
            label={createTree.isPending ? t("create.submitting") : t("create.submit")}
            onPress={submit}
            loading={createTree.isPending}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
