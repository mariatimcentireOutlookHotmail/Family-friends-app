import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { useLink, useRemoveLink, useUpdateLink, type LinkDetails } from "@/lib/people";
import { SUBTYPES_FOR, type Certainty, type RelationshipSubtype } from "@/lib/relatives";
import { primaryName } from "@/lib/trees";

const CERTAINTIES: Certainty[] = ["confirmed", "probable", "uncertain"];

export default function EditLinkScreen() {
  const { t } = useTranslation("edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLink(id);

  if (query.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }
  if (!query.data) {
    return (
      <View className="flex-1 bg-gray-50 p-6 dark:bg-black">
        <Text className="text-base text-gray-900 dark:text-gray-100">{t("link.notFound")}</Text>
      </View>
    );
  }
  return <LinkForm link={query.data} />;
}

function LinkForm({ link }: { link: LinkDetails }) {
  const { t } = useTranslation("edit");
  const updateLink = useUpdateLink();
  const removeLink = useRemoveLink();
  const [subtype, setSubtype] = useState<RelationshipSubtype | null>(link.subtype);
  const [certainty, setCertainty] = useState<Certainty>(link.certainty);
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const a = primaryName(link.a) ?? "—";
  const b = primaryName(link.b) ?? "—";
  // Parent links read "A is a parent of B"; the others go both ways.
  const subtypes = link.type === "parent" ? SUBTYPES_FOR.parent : SUBTYPES_FOR[link.type];
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const save = () => {
    setError(null);
    updateLink.mutate(
      { linkId: link.id, subtype, certainty },
      {
        onSuccess: leave,
        onError: (e) => {
          if (__DEV__) console.warn("[update link error]", e);
          setError(t("link.failed"));
        },
      },
    );
  };

  const remove = () => {
    setRemoveError(null);
    removeLink.mutate(link.id, {
      onSuccess: leave,
      onError: (e) => {
        if (__DEV__) console.warn("[remove link error]", e);
        setRemoveError(t("link.failed"));
      },
    });
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-black" contentContainerClassName="items-center p-6">
      <View className="w-full max-w-md gap-6">
        <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t(`link.${link.type}`, { a, b })}</Text>

        {subtype && subtypes.length > 0 ? (
          <ChoiceChips
            label={t("link.subtypeLabel")}
            value={subtype}
            onChange={setSubtype}
            options={subtypes.map((s) => ({ value: s, label: t(`subtypes.${s}`, { ns: "person" }) }))}
          />
        ) : null}

        <ChoiceChips
          label={t("certainty.label", { ns: "person" })}
          value={certainty}
          onChange={setCertainty}
          options={CERTAINTIES.map((c) => ({ value: c, label: t(`certainty.${c}`, { ns: "person" }) }))}
        />

        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </Text>
        ) : null}

        <Button label={updateLink.isPending ? t("link.saving") : t("link.save")} onPress={save} loading={updateLink.isPending} />

        <ConfirmAction
          title={t("link.removeTitle")}
          explain={t("link.removeExplain")}
          buttonLabel={t("link.remove")}
          confirmText={t("link.confirm")}
          confirmLabel={t("link.confirmButton")}
          cancelLabel={t("link.cancel")}
          busyLabel={t("link.removing")}
          busy={removeLink.isPending}
          error={removeError}
          onConfirm={remove}
        />
      </View>
    </ScrollView>
  );
}
