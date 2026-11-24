import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Linking, ScrollView, Text, View } from "react-native";

import { InviteSection } from "@/components/InviteSection";
import { LifeDates } from "@/components/LifeDates";
import { LinkedTrees } from "@/components/LinkedTrees";
import { PersonPhotos, ProfilePhoto } from "@/components/PersonPhotos";
import { PersonStories } from "@/components/PersonStories";
import { SocialList } from "@/components/SocialLinks";
import { PersonRow } from "@/components/PersonRow";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { canInvite } from "@/lib/invites";
import { useProfilePhotos } from "@/lib/photos";
import { useMemorial } from "@/lib/stories";
import { contactsOf, permissionsFor, usePerson } from "@/lib/people";
import { socialEntries } from "@/lib/social";
import { groupRelatives, impliedSiblingIds, type LinkedPerson, type Relative, type RelativeGroups } from "@/lib/relatives";
import { everydayName, lifeYears, primaryName, useMyTrees } from "@/lib/trees";
import { labelText, useKinship } from "@/lib/useKinship";

const SECTION_ORDER: (keyof RelativeGroups)[] = ["parents", "partners", "children", "siblings", "friends"];

export default function PersonScreen() {
  const { t } = useTranslation("person");
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const query = usePerson(id);
  // Kinship needs the whole tree (all links), which the home screen loads.
  const trees = useMyTrees();
  const kinship = useKinship(trees.data?.find((tree) => tree.id === query.data?.tree_id));
  // "Edit relationships" mode: tapping a relative opens the link editor.
  const [managing, setManaging] = useState(false);
  const profilePhotos = useProfilePhotos(query.data?.tree_id);
  const memorial = useMemorial(id);

  if (query.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  if (query.isError || !query.data) {
    return (
      <View className="flex-1 items-center bg-gray-50 p-6 dark:bg-black">
        <View className="w-full max-w-md gap-3">
          <Text className="text-base text-gray-900 dark:text-gray-100">
            {query.isError ? t("page.loadError") : t("page.notFound")}
          </Text>
          {query.isError ? (
            <Button variant="secondary" label={t("page.retry")} onPress={() => void query.refetch()} />
          ) : null}
        </View>
      </View>
    );
  }

  const person = query.data;
  const perms = permissionsFor(person, session?.user.id);
  // A child the viewer may not see is shown as a placeholder.
  const name = primaryName(person) ?? (perms.hiddenMinor ? t("minor.name", { ns: "privacy" }) : "—");
  const contacts = contactsOf(person);
  const relativeName = (p: LinkedPerson) => everydayName(p) ?? t("minor.name", { ns: "privacy" });
  const otherNames = person.person_names.filter((n) => !n.is_primary);
  const groups = groupRelatives(person.id, person.relationships);
  // Brothers and sisters through a shared parent, without a sibling link of their own.
  const tree = trees.data?.find((x) => x.id === person.tree_id);
  const implied = impliedSiblingIds(person.id, tree?.relationships ?? [])
    .map((id) => tree?.persons.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const hasRelatives = SECTION_ORDER.some((key) => groups[key].length > 0) || implied.length > 0;

  /** "Adoptive · Probably · Deceased" — only the details worth mentioning. */
  const details = (relative: Relative) =>
    [
      relative.subtype && relative.subtype !== "biological" && relative.subtype !== "full"
        ? t(`subtypes.${relative.subtype}`)
        : null,
      relative.certainty !== "confirmed" ? t(`certainty.${relative.certainty}`) : null,
      relative.person.living_status === "deceased" ? t("page.deceased") : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-black" contentContainerClassName="items-center p-6">
      <Stack.Screen options={{ title: name }} />
      <View className="w-full max-w-md gap-6">
        <View className="gap-2">
          {!perms.hiddenMinor ? <ProfilePhoto personId={person.id} name={name} /> : null}
          {memorial.data?.on && person.living_status === "deceased" ? (
            <Text className="text-sm font-medium uppercase tracking-widest text-gray-500">
              {lifeYears(person)
                ? t("memorial.bannerYears", { ns: "stories", years: lifeYears(person) })
                : t("memorial.banner", { ns: "stories" })}
            </Text>
          ) : null}
          <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100">{name}</Text>
          {labelText(kinship.get(person.id)) ? (
            <Text className="text-base text-indigo-700 dark:text-indigo-300">
              {t("page.relationToYou", { relation: labelText(kinship.get(person.id)) })}
            </Text>
          ) : null}
          <LifeDates events={person.events ?? []} living={person.living_status} />
          <View className="flex-row flex-wrap gap-2">
            {person.claimed_by_user_id === session?.user.id ? (
              <Text className="rounded-full bg-indigo-50 px-2 py-0.5 text-sm font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                {t("page.you")}
              </Text>
            ) : null}
            {person.living_status === "deceased" ? (
              <Text className="rounded-full bg-gray-200 px-2 py-0.5 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {t("page.deceased")}
              </Text>
            ) : null}
          </View>
          {perms.hiddenMinor ? (
            <Text className="text-sm text-gray-600 dark:text-gray-400">{t("minor.note", { ns: "privacy" })}</Text>
          ) : null}
          {perms.canEditPerson ? (
            <Button
              variant="secondary"
              label={t("page.edit", { ns: "edit" })}
              onPress={() => router.push({ pathname: "/person/[id]/edit", params: { id: person.id } })}
            />
          ) : perms.claimedBySomeoneElse && perms.canEditLinks ? (
            <Text className="text-sm text-gray-600 dark:text-gray-400">
              {t("person.claimedNote", { ns: "edit", name })}
            </Text>
          ) : null}
        </View>

        <Button
          variant="secondary"
          label={t("showInTree", { ns: "treeView" })}
          onPress={() =>
            router.push({ pathname: "/tree/[id]", params: { id: person.tree_id, focus: person.id } })
          }
        />

        <Button
          variant="secondary"
          label={t("open", { ns: "history" })}
          onPress={() =>
            router.push({ pathname: "/history/[treeId]", params: { treeId: person.tree_id, person: person.id } })
          }
        />

        {!perms.hiddenMinor ? <PersonPhotos person={person} name={name} /> : null}

        {!perms.hiddenMinor ? <PersonStories person={person} name={name} /> : null}

        {person.myRole === "owner" && person.living_status === "deceased" ? (
          <Button
            variant="secondary"
            label={t("memorial.settings", { ns: "stories" })}
            onPress={() => router.push({ pathname: "/person/[id]/memorial", params: { id: person.id } })}
          />
        ) : null}

        {canInvite(person) ? <InviteSection personId={person.id} name={name} /> : null}

        {!perms.hiddenMinor && !person.my_access?.isMinor ? (
          <LinkedTrees personId={person.id} name={name} isOwner={person.myRole === "owner"} />
        ) : null}

        {perms.canChangePrivacy ? (
          <Button
            variant="secondary"
            label={t("screen.button", { ns: "privacy" })}
            onPress={() => router.push({ pathname: "/person/[id]/privacy", params: { id: person.id } })}
          />
        ) : null}

        {contacts && (contacts.phone || contacts.email || contacts.address || socialEntries(contacts.social).length > 0) ? (
          <View className="gap-1 rounded-xl bg-white p-4 dark:bg-gray-900">
            <Text className="text-sm font-semibold text-gray-600 dark:text-gray-400">
              {t("contacts.title", { ns: "privacy" })}
            </Text>
            {contacts.phone ? (
              <Text
                className="text-base text-indigo-700 dark:text-indigo-300"
                onPress={() => void Linking.openURL(`tel:${contacts.phone!.replace(/\s/g, "")}`)}
              >
                {contacts.phone}
              </Text>
            ) : null}
            {contacts.email ? (
              <Text
                className="text-base text-indigo-700 dark:text-indigo-300"
                onPress={() => void Linking.openURL(`mailto:${contacts.email}`)}
              >
                {contacts.email}
              </Text>
            ) : null}
            {contacts.address ? (
              <Text className="text-base text-gray-900 dark:text-gray-100">{contacts.address}</Text>
            ) : null}
            <SocialList links={contacts.social} />
          </View>
        ) : null}

        {otherNames.length > 0 ? (
          <View className="gap-1 rounded-xl bg-white p-4 dark:bg-gray-900">
            <Text className="text-sm font-semibold text-gray-600 dark:text-gray-400">{t("page.alsoKnownAs")}</Text>
            {otherNames.map((n) => (
              <Text key={`${n.type}-${n.full_display}`} className="text-base text-gray-900 dark:text-gray-100">
                {n.full_display}
                {/* The heading already says "also known as"; label only other kinds. */}
                {n.type !== "aka" ? (
                  <Text className="text-sm text-gray-500"> · {t(`nameTypes.${n.type}`, { ns: "tree" })}</Text>
                ) : null}
              </Text>
            ))}
          </View>
        ) : null}

        {perms.canEditLinks && hasRelatives ? (
          <View className="gap-1">
            <Button
              variant={managing ? "primary" : "secondary"}
              label={managing ? t("page.doneManaging", { ns: "edit" }) : t("page.manageLinks", { ns: "edit" })}
              onPress={() => setManaging((m) => !m)}
            />
            {managing ? (
              <Text className="text-sm text-gray-600 dark:text-gray-400">{t("page.manageHint", { ns: "edit" })}</Text>
            ) : null}
          </View>
        ) : null}

        {hasRelatives ? (
          SECTION_ORDER.filter((key) => groups[key].length > 0 || (key === "siblings" && implied.length > 0)).map((key) => (
            <View key={key} className="rounded-xl bg-white px-4 pt-3 dark:bg-gray-900">
              <Text className="text-sm font-semibold text-gray-600 dark:text-gray-400">{t(`sections.${key}`)}</Text>
              {groups[key].map((relative, index) => (
                <PersonRow
                  key={relative.relationshipId}
                  first={index === 0}
                  name={relativeName(relative.person)}
                  photo={profilePhotos.data?.get(relative.person.id)}
                  subtitle={details(relative) || null}
                  onPress={() =>
                    managing
                      ? router.push({ pathname: "/link/[id]", params: { id: relative.relationshipId } })
                      : router.push({ pathname: "/person/[id]", params: { id: relative.person.id } })
                  }
                />
              ))}
              {key === "siblings"
                ? implied.map((sib, index) => (
                    <PersonRow
                      key={sib.id}
                      first={groups.siblings.length === 0 && index === 0}
                      name={everydayName(sib) ?? t("minor.name", { ns: "privacy" })}
                      photo={profilePhotos.data?.get(sib.id)}
                      subtitle={t("page.viaParents")}
                      onPress={() => router.push({ pathname: "/person/[id]", params: { id: sib.id } })}
                    />
                  ))
                : null}
            </View>
          ))
        ) : (
          <Text className="text-base text-gray-600 dark:text-gray-400">{t("page.noRelatives")}</Text>
        )}

        {perms.canEditLinks ? (
          <Button
            label={t("page.addRelative")}
            onPress={() => router.push({ pathname: "/person/[id]/add-relative", params: { id: person.id } })}
          />
        ) : (
          <Text className="text-sm text-gray-600 dark:text-gray-400">{t("page.viewOnly")}</Text>
        )}
      </View>
    </ScrollView>
  );
}
