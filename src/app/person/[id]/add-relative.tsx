import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";

import { DateField, checkDates } from "@/components/DateField";
import { NameEditor, draftsToNames, emptyName, type NameDraft } from "@/components/NameEditor";
import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { draftToDate, emptyDateDraft, toPayload, type DateDraft } from "@/lib/dates";
import { formatFullName } from "@/lib/names";
import { addRelativeErrorKey, useAddRelative, usePerson } from "@/lib/people";
import {
  SUBTYPES_FOR,
  groupRelatives,
  type Certainty,
  type LinkedPerson,
  type Relation,
  type RelationshipSubtype,
} from "@/lib/relatives";
import { primaryName, type Sex } from "@/lib/trees";

const MAX_NAMES = 10;
const RELATIONS: Relation[] = ["parent", "partner", "child", "sibling", "friend"];
const CERTAINTIES: Certainty[] = ["confirmed", "probable", "uncertain"];
const LIVING: LinkedPerson["living_status"][] = ["living", "deceased", "unknown"];
const SEXES: Sex[] = ["female", "male", "other", "unknown"];

export default function AddRelativeScreen() {
  const { t } = useTranslation("person");
  const { id } = useLocalSearchParams<{ id: string }>();
  const anchor = usePerson(id);
  const addRelative = useAddRelative();
  const nextKey = useRef(1);

  const [relation, setRelation] = useState<Relation>("parent");
  const [subtype, setSubtype] = useState<RelationshipSubtype | null>(SUBTYPES_FOR.parent[0] ?? null);
  const [certainty, setCertainty] = useState<Certainty>("confirmed");
  const [names, setNames] = useState<NameDraft[]>([emptyName("name-0")]);
  const [sex, setSex] = useState<Sex>("unknown");
  const [living, setLiving] = useState<LinkedPerson["living_status"]>("living");
  const [alsoChildOfPartner, setAlsoChildOfPartner] = useState(true);
  const [birth, setBirth] = useState<DateDraft>(emptyDateDraft);
  const [death, setDeath] = useState<DateDraft>(emptyDateDraft);
  const [dateErrors, setDateErrors] = useState<{ birth: string | null; death: string | null }>({ birth: null, death: null });
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  if (anchor.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }
  if (!anchor.data) {
    return (
      <View className="flex-1 bg-gray-50 p-6 dark:bg-black">
        <Text className="text-base text-gray-900 dark:text-gray-100">{t("page.notFound")}</Text>
      </View>
    );
  }

  const anchorPerson = anchor.data;
  const anchorName = primaryName(anchorPerson) ?? "—";
  // Offer "also the child of <partner>" only when there is exactly one partner.
  const partners = groupRelatives(anchorPerson.id, anchorPerson.relationships).partners;
  const onlyPartner = partners.length === 1 ? partners[0]!.person : null;
  const showAlsoChild = relation === "child" && onlyPartner !== null;

  const chooseRelation = (next: Relation) => {
    setRelation(next);
    setSubtype(SUBTYPES_FOR[next][0] ?? null);
  };

  const updateName = (index: number, next: NameDraft) => {
    setNames((list) => list.map((n, i) => (i === index ? next : n)));
    setNameErrors(({ [next.key]: _cleared, ...rest }) => rest);
  };

  const submit = () => {
    setFormError(null);
    const missing: Record<string, string> = {};
    names.forEach((n) => {
      if (!formatFullName(n)) missing[n.key] = t("add.errors.nameRequired");
    });
    setNameErrors(missing);
    const isDeceased = living === "deceased";
    const errors = checkDates(birth, isDeceased ? death : null);
    setDateErrors({
      birth: errors.birth ? t(`errors.${errors.birth}`, { ns: "dates" }) : null,
      death: errors.death ? t(`errors.${errors.death}`, { ns: "dates" }) : null,
    });
    if (Object.keys(missing).length > 0 || errors.birth || errors.death) return;

    addRelative.mutate(
      {
        anchorId: anchorPerson.id,
        relation,
        subtype,
        certainty,
        names: draftsToNames(names),
        sex,
        living,
        otherParentId: showAlsoChild && alsoChildOfPartner ? onlyPartner!.id : null,
        birth: toPayload(draftToDate(birth)),
        death: isDeceased ? toPayload(draftToDate(death)) : null,
      },
      {
        onSuccess: () => (router.canGoBack() ? router.back() : router.replace("/")),
        onError: (error) => {
          if (__DEV__) console.warn("[add relative error]", error);
          setFormError(t(`add.errors.${addRelativeErrorKey(error)}`));
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
          <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {t("add.heading", { name: anchorName })}
          </Text>

          <ChoiceChips
            label={t("add.relationLabel", { name: anchorName })}
            value={relation}
            onChange={chooseRelation}
            options={RELATIONS.map((r) => ({ value: r, label: t(`relation.${r}`) }))}
          />

          {subtype ? (
            <ChoiceChips
              label={t("add.subtypeLabel")}
              value={subtype}
              onChange={setSubtype}
              options={SUBTYPES_FOR[relation].map((s) => ({ value: s, label: t(`subtypes.${s}`) }))}
            />
          ) : null}

          {showAlsoChild ? (
            <View className="flex-row items-center justify-between gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
              <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">
                {t("add.alsoChildOf", { name: primaryName(onlyPartner!) ?? "—" })}
              </Text>
              <Switch
                value={alsoChildOfPartner}
                onValueChange={setAlsoChildOfPartner}
                accessibilityLabel={t("add.alsoChildOf", { name: primaryName(onlyPartner!) ?? "—" })}
              />
            </View>
          ) : null}

          <ChoiceChips
            label={t("certainty.label")}
            value={certainty}
            onChange={setCertainty}
            options={CERTAINTIES.map((c) => ({ value: c, label: t(`certainty.${c}`) }))}
          />

          <View className="gap-3">
            <Text className="text-sm text-gray-600 dark:text-gray-400">{t("names.hint", { ns: "tree" })}</Text>
            {names.map((name, index) => (
              <NameEditor
                key={name.key}
                value={name}
                isMain={index === 0}
                mainTitle={t("add.theirName")}
                onChange={(next) => updateName(index, next)}
                onRemove={index > 0 ? () => setNames((list) => list.filter((_, i) => i !== index)) : undefined}
                error={nameErrors[name.key]}
              />
            ))}
            {names.length < MAX_NAMES ? (
              <Button
                variant="secondary"
                label={t("names.add", { ns: "tree" })}
                onPress={() => setNames((list) => [...list, emptyName(`name-${nextKey.current++}`, false)])}
              />
            ) : null}
          </View>

          <ChoiceChips
            label={t("sex.label", { ns: "tree" })}
            value={sex}
            onChange={setSex}
            options={SEXES.map((s) => ({ value: s, label: t(`sex.${s}`, { ns: "tree" }) }))}
          />

          <ChoiceChips
            label={t("living.label")}
            value={living}
            onChange={setLiving}
            options={LIVING.map((l) => ({ value: l, label: t(`living.${l}`) }))}
          />

          <DateField
            label={t("fields.birthLabel", { ns: "dates" })}
            value={birth}
            onChange={(next) => {
              setBirth(next);
              setDateErrors((e) => ({ ...e, birth: null }));
            }}
            error={dateErrors.birth}
            showHint
          />

          {living === "deceased" ? (
            <DateField
              label={t("fields.deathLabel", { ns: "dates" })}
              value={death}
              onChange={(next) => {
                setDeath(next);
                setDateErrors((e) => ({ ...e, death: null }));
              }}
              error={dateErrors.death}
            />
          ) : null}

          {formError ? (
            <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
              {formError}
            </Text>
          ) : null}

          <Button
            label={addRelative.isPending ? t("add.submitting") : t("add.submit")}
            onPress={submit}
            loading={addRelative.isPending}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
