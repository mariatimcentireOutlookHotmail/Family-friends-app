import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { DateField, checkDates } from "@/components/DateField";
import { NameEditor, draftFromName, draftsToNames, emptyName, type NameDraft } from "@/components/NameEditor";
import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/lib/auth";
import { dateToDraft, draftToDate, eventToDate, hasHiddenParts, toPayload, type DateDraft } from "@/lib/dates";
import { formatFullName } from "@/lib/names";
import {
  contactsOf,
  editErrorKey,
  permissionsFor,
  useDeletePerson,
  usePerson,
  useSavePerson,
  type PersonDetails,
} from "@/lib/people";
import type { LinkedPerson } from "@/lib/relatives";
import { primaryName, type Sex } from "@/lib/trees";

const MAX_NAMES = 10;
const SEXES: Sex[] = ["female", "male", "other", "unknown"];
const LIVING: LinkedPerson["living_status"][] = ["living", "deceased", "unknown"];
/** Countries with a known minors' age limit (see the privacy migration). */
const COUNTRIES = ["ID", "CN", "MY", "SG", "US", "other"] as const;
type CountryChoice = (typeof COUNTRIES)[number];

export default function EditPersonScreen() {
  const { t } = useTranslation("edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePerson(id);

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
        <Text className="text-base text-gray-900 dark:text-gray-100">{t("page.notFound", { ns: "person" })}</Text>
      </View>
    );
  }
  // A separate component so the form starts from the loaded data.
  return <EditForm person={query.data} />;
}

function EditForm({ person }: { person: PersonDetails }) {
  const { t } = useTranslation("edit");
  const { session } = useAuth();
  const savePerson = useSavePerson();
  const deletePerson = useDeletePerson();
  const nextKey = useRef(100);
  const perms = permissionsFor(person, session?.user.id);
  const name = primaryName(person) ?? "—";

  // Main name first, then the others in their saved order.
  const sorted = [...person.person_names].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const [names, setNames] = useState<NameDraft[]>(
    sorted.length ? sorted.map((n, i) => draftFromName(n, `name-${i}`)) : [emptyName("name-0")],
  );
  const [sex, setSex] = useState<Sex>(person.sex);
  const [living, setLiving] = useState<LinkedPerson["living_status"]>(person.living_status);
  const birthEvent = person.events.find((e) => e.type === "birth");
  const deathEvent = person.events.find((e) => e.type === "death");
  const [birth, setBirth] = useState<DateDraft>(dateToDraft(birthEvent ? eventToDate(birthEvent) : null));
  const [death, setDeath] = useState<DateDraft>(dateToDraft(deathEvent ? eventToDate(deathEvent) : null));
  const [dateErrors, setDateErrors] = useState<{ birth: string | null; death: string | null }>({ birth: null, death: null });
  const [country, setCountry] = useState<CountryChoice>(
    (COUNTRIES as readonly string[]).includes(person.country ?? "") ? (person.country as CountryChoice) : "other",
  );
  const canSeeContacts = person.my_access?.canSeeContacts ?? false;
  const saved = contactsOf(person);
  const [phone, setPhone] = useState(saved?.phone ?? "");
  const [email, setEmail] = useState(saved?.email ?? "");
  const [address, setAddress] = useState(saved?.address ?? "");
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const updateName = (index: number, next: NameDraft) => {
    setNames((list) => list.map((n, i) => (i === index ? next : n)));
    setNameErrors(({ [next.key]: _cleared, ...rest }) => rest);
  };

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const save = () => {
    setFormError(null);
    const missing: Record<string, string> = {};
    names.forEach((n) => {
      if (!formatFullName(n)) missing[n.key] = t("person.errors.nameRequired");
    });
    setNameErrors(missing);
    const isDeceased = living === "deceased";
    const errors = checkDates(birth, isDeceased ? death : null);
    setDateErrors({
      birth: errors.birth ? t(`errors.${errors.birth}`, { ns: "dates" }) : null,
      death: errors.death ? t(`errors.${errors.death}`, { ns: "dates" }) : null,
    });
    if (Object.keys(missing).length > 0 || errors.birth || errors.death) return;

    savePerson.mutate(
      {
        personId: person.id,
        names: draftsToNames(names),
        sex,
        living,
        birth: toPayload(draftToDate(birth)),
        // Not deceased (any more): no date of death.
        death: isDeceased ? toPayload(draftToDate(death)) : null,
        country: country === "other" ? null : country,
        // Contacts the user can't see are left unchanged.
        contacts: canSeeContacts ? { phone, email, address } : null,
      },
      {
        onSuccess: leave,
        onError: (error) => {
          if (__DEV__) console.warn("[save person error]", error);
          setFormError(t(`person.errors.${editErrorKey(error)}`));
        },
      },
    );
  };

  const remove = () => {
    setDeleteError(null);
    deletePerson.mutate(person.id, {
      // The person's own pages no longer exist: go back to the start.
      onSuccess: () => router.dismissTo("/"),
      onError: (error) => {
        if (__DEV__) console.warn("[delete person error]", error);
        setDeleteError(t("delete.failed"));
      },
    });
  };

  if (!perms.canEditPerson) {
    return (
      <View className="flex-1 items-center bg-gray-50 p-6 dark:bg-black">
        <Text className="w-full max-w-md text-base text-gray-900 dark:text-gray-100">
          {perms.claimedBySomeoneElse ? t("person.claimedNote", { name }) : t("person.errors.notAllowed")}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-gray-50 dark:bg-black"
    >
      <ScrollView contentContainerClassName="items-center p-6" keyboardShouldPersistTaps="handled">
        <View className="w-full max-w-md gap-6">
          <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {t("person.heading", { name })}
          </Text>

          <View className="gap-3">
            {names.map((draft, index) => (
              <NameEditor
                key={draft.key}
                value={draft}
                isMain={index === 0}
                mainTitle={t("add.theirName", { ns: "person" })}
                onChange={(next) => updateName(index, next)}
                onRemove={index > 0 ? () => setNames((list) => list.filter((_, i) => i !== index)) : undefined}
                error={nameErrors[draft.key]}
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
            label={t("living.label", { ns: "person" })}
            value={living}
            onChange={setLiving}
            options={LIVING.map((l) => ({ value: l, label: t(`living.${l}`, { ns: "person" }) }))}
          />

          <DateField
            label={t("fields.birthLabel", { ns: "dates" })}
            value={birth}
            onChange={(next) => {
              setBirth(next);
              setDateErrors((e) => ({ ...e, birth: null }));
            }}
            error={dateErrors.birth}
            hiddenKept={Boolean(birthEvent && hasHiddenParts(birthEvent) && birth.year)}
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
              hiddenKept={Boolean(deathEvent && hasHiddenParts(deathEvent) && death.year)}
            />
          ) : null}

          <View className="gap-1.5">
            <ChoiceChips
              label={t("country.label", { ns: "privacy" })}
              value={country}
              onChange={setCountry}
              options={COUNTRIES.map((c) => ({ value: c, label: t(`country.${c}`, { ns: "privacy" }) }))}
            />
            <Text className="text-sm text-gray-600 dark:text-gray-400">{t("country.hint", { ns: "privacy" })}</Text>
          </View>

          <View className="gap-3">
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t("contacts.title", { ns: "privacy" })}
            </Text>
            {canSeeContacts ? (
              <>
                <Text className="text-sm text-gray-600 dark:text-gray-400">{t("contacts.privateHint", { ns: "privacy" })}</Text>
                <TextField
                  label={t("contacts.phone", { ns: "privacy" })}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  maxLength={50}
                />
                <TextField
                  label={t("contacts.email", { ns: "privacy" })}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  maxLength={254}
                />
                <TextField
                  label={t("contacts.address", { ns: "privacy" })}
                  value={address}
                  onChangeText={setAddress}
                  multiline
                  maxLength={500}
                />
              </>
            ) : (
              <Text className="text-sm text-gray-600 dark:text-gray-400">{t("contacts.hiddenNote", { ns: "privacy" })}</Text>
            )}
          </View>

          {formError ? (
            <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
              {formError}
            </Text>
          ) : null}

          <Button
            label={savePerson.isPending ? t("person.saving") : t("person.save")}
            onPress={save}
            loading={savePerson.isPending}
          />

          {perms.canDelete ? (
            <ConfirmAction
              title={t("delete.title")}
              explain={t("delete.explain", { name })}
              buttonLabel={t("delete.button", { name })}
              confirmText={t("delete.confirm", { name })}
              confirmLabel={t("delete.confirmButton")}
              cancelLabel={t("delete.cancel")}
              busyLabel={t("delete.deleting")}
              busy={deletePerson.isPending}
              error={deleteError}
              onConfirm={remove}
            />
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
