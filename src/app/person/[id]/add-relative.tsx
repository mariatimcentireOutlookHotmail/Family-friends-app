import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { DateField, checkDates } from "@/components/DateField";
import { NameEditor, draftsToNames, emptyName, type NameDraft } from "@/components/NameEditor";
import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { TextField } from "@/components/ui/TextField";
import { draftToDate, emptyDateDraft, toPayload, type DateDraft } from "@/lib/dates";
import { formatFullName } from "@/lib/names";
import { addRelativeErrorKey, useAddRelative, useLinkPeople, usePerson } from "@/lib/people";
import {
  SUBTYPES_FOR,
  allSiblingIds,
  childIds,
  directSiblingIds,
  groupRelatives,
  parentIds,
  type Certainty,
  type LinkedPerson,
  type Relation,
  type RelationshipSubtype,
} from "@/lib/relatives";
import { everydayName, lifeYears, primaryName, useMyTrees, type Sex, type TreePerson } from "@/lib/trees";

const MAX_NAMES = 10;
// Tick-box symbols (not words, so nothing to translate).
const CHECKED = "☑";
const UNCHECKED = "☐";
const RELATIONS: Relation[] = ["parent", "partner", "child", "sibling", "friend"];
const CERTAINTIES: Certainty[] = ["confirmed", "probable", "uncertain"];
const LIVING: LinkedPerson["living_status"][] = ["living", "deceased", "unknown"];
const SEXES: Sex[] = ["female", "male", "other", "unknown"];

export default function AddRelativeScreen() {
  const { t } = useTranslation("person");
  const { id } = useLocalSearchParams<{ id: string }>();
  const anchor = usePerson(id);
  const addRelative = useAddRelative();
  const linkPeople = useLinkPeople();
  const trees = useMyTrees();
  const nextKey = useRef(1);

  /** "new": add a new person. "existing": connect someone already in the tree. */
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  // Suggestions: who else the new person should be connected to.
  const [alsoChildOfParents, setAlsoChildOfParents] = useState(true);
  const [alsoParentOf, setAlsoParentOf] = useState<Record<string, boolean>>({});

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

  const tree = trees.data?.find((x) => x.id === anchorPerson.tree_id);
  const links = tree?.relationships ?? [];
  const personById = new Map((tree?.persons ?? []).map((p) => [p.id, p]));
  const label = (id: string) => {
    const p = personById.get(id);
    return p ? (everydayName(p) ?? t("minor.name", { ns: "privacy" })) : "—";
  };
  // A new full sibling: make them a child of the same parents instead.
  const anchorParents = parentIds(anchorPerson.id, links).slice(0, 2);
  const showChildOfParents = relation === "sibling" && subtype === "full" && anchorParents.length > 0;
  // A new parent: offer to make them the parent of the anchor's siblings too.
  const parentCandidates =
    relation === "parent"
      ? allSiblingIds(anchorPerson.id, links).filter((id) => parentIds(id, links).length < 2)
      : [];
  const parentOfChosen = parentCandidates.filter((id) => alsoParentOf[id] ?? true);

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

    const done = () => (router.canGoBack() ? router.back() : router.replace("/"));
    const fail = (error: unknown) => {
      if (__DEV__) console.warn("[add relative error]", error);
      setFormError(t(`add.errors.${addRelativeErrorKey(error)}`));
    };
    const common = {
      certainty,
      names: draftsToNames(names),
      sex,
      living,
      birth: toPayload(draftToDate(birth)),
      death: isDeceased ? toPayload(draftToDate(death)) : null,
    };

    if (showChildOfParents && alsoChildOfParents) {
      // Full sibling = child of the same parent(s).
      addRelative.mutate(
        {
          ...common,
          anchorId: anchorParents[0]!,
          relation: "child",
          subtype: "biological",
          otherParentId: anchorParents[1] ?? null,
        },
        { onSuccess: done, onError: fail },
      );
      return;
    }

    addRelative.mutate(
      {
        ...common,
        anchorId: anchorPerson.id,
        relation,
        subtype,
        otherParentId: showAlsoChild && alsoChildOfPartner ? onlyPartner!.id : null,
      },
      {
        onSuccess: (newId) => {
          if (parentOfChosen.length === 0) return done();
          linkPeople.mutate(
            { personId: newId, relation: "child", others: parentOfChosen, subtype, certainty },
            {
              onSuccess: done,
              onError: (error) => {
                if (__DEV__) console.warn("[link siblings error]", error);
                setFormError(t("add.errors.partlyLinked", { reason: t(`add.errors.${addRelativeErrorKey(error)}`) }));
              },
            },
          );
        },
        onError: fail,
      },
    );
  };

  const submitExisting = () => {
    setFormError(null);
    linkPeople.mutate(
      { personId: anchorPerson.id, relation, others: picked, subtype, certainty },
      {
        onSuccess: () => (router.canGoBack() ? router.back() : router.replace("/")),
        onError: (error) => {
          if (__DEV__) console.warn("[link people error]", error);
          setFormError(t(`add.errors.${addRelativeErrorKey(error)}`));
        },
      },
    );
  };

  // People to choose from: everyone in the tree but this person and those
  // already linked to them this way.
  const alreadyLinked = new Set(
    relation === "parent"
      ? parentIds(anchorPerson.id, links)
      : relation === "child"
        ? childIds(anchorPerson.id, links)
        : relation === "sibling"
          ? directSiblingIds(anchorPerson.id, links)
          : links
              .filter((l) => l.type === relation && (l.person_a === anchorPerson.id || l.person_b === anchorPerson.id))
              .map((l) => (l.person_a === anchorPerson.id ? l.person_b : l.person_a)),
  );
  const q = search.trim().toLowerCase();
  const choices: TreePerson[] = (tree?.persons ?? [])
    .filter((p) => p.id !== anchorPerson.id && !alreadyLinked.has(p.id) && primaryName(p))
    .filter((p) => !q || p.person_names.some((n) => n.full_display.toLowerCase().includes(q)))
    .sort((a, b) => (everydayName(a) ?? "").localeCompare(everydayName(b) ?? ""));
  const togglePick = (id: string) =>
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));


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
            label={t("add.modeLabel")}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setFormError(null);
            }}
            options={[
              { value: "new", label: t("add.modeNew") },
              { value: "existing", label: t("add.modeExisting") },
            ]}
          />

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

          {mode === "new" && showChildOfParents ? (
            <View className="flex-row items-center justify-between gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
              <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">
                {t("add.alsoChildOfParents", { names: anchorParents.map(label).join(" & ") })}
              </Text>
              <Switch
                value={alsoChildOfParents}
                onValueChange={setAlsoChildOfParents}
                accessibilityLabel={t("add.alsoChildOfParents", { names: anchorParents.map(label).join(" & ") })}
              />
            </View>
          ) : null}

          {mode === "new" && parentCandidates.length > 0 ? (
            <View className="gap-2 rounded-xl bg-white p-4 dark:bg-gray-900">
              <Text className="text-base text-gray-900 dark:text-gray-100">{t("add.alsoParentOf")}</Text>
              {parentCandidates.map((id) => (
                <View key={id} className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-base text-gray-800 dark:text-gray-200">{label(id)}</Text>
                  <Switch
                    value={alsoParentOf[id] ?? true}
                    onValueChange={(v) => setAlsoParentOf((m) => ({ ...m, [id]: v }))}
                    accessibilityLabel={`${t("add.alsoParentOf")} ${label(id)}`}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {mode === "new" && showAlsoChild ? (
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

          {mode === "existing" ? (
            <View className="gap-2">
              <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t("add.pickExisting", { relation: t(`relation.${relation}`).toLowerCase(), name: anchorName })}
              </Text>
              {(tree?.persons.length ?? 0) > 8 ? (
                <TextField label={t("add.search")} value={search} onChangeText={setSearch} autoCorrect={false} />
              ) : null}
              {choices.length === 0 ? (
                <Text className="text-sm text-gray-600 dark:text-gray-400">{t("add.noOneToPick")}</Text>
              ) : null}
              {choices.map((p) => {
                const selected = picked.includes(p.id);
                const text = [everydayName(p), lifeYears(p)].filter(Boolean).join(" · ");
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => togglePick(p.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={text}
                    className={`min-h-11 flex-row items-center gap-3 rounded-lg border px-3 ${
                      selected
                        ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                        : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                    }`}
                  >
                    <Text className="text-base text-indigo-700 dark:text-indigo-300">{selected ? CHECKED : UNCHECKED}</Text>
                    <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">{text}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <>
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

            </>
          )}

          {formError ? (
            <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
              {formError}
            </Text>
          ) : null}

          {mode === "new" ? (
            <Button
              label={addRelative.isPending || linkPeople.isPending ? t("add.submitting") : t("add.submit")}
              onPress={submit}
              loading={addRelative.isPending || linkPeople.isPending}
            />
          ) : (
            <Button
              label={linkPeople.isPending ? t("add.linking") : t("add.linkSubmit", { count: picked.length })}
              onPress={submitExisting}
              loading={linkPeople.isPending}
              disabled={picked.length === 0}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
