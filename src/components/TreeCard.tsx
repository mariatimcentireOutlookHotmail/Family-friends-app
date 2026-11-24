import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { PersonRow } from "@/components/PersonRow";
import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { useAuth } from "@/lib/auth";
import { useProfilePhotos } from "@/lib/photos";
import { akaNames, everydayName, knownAs, lifeYears, primaryName, type Tree, type TreePerson } from "@/lib/trees";
import { useKinship } from "@/lib/useKinship";

type ViewMode = "list" | "cards";

/** A family tree's name and its people, as a list or as cards. */
export function TreeCard({ tree }: { tree: Tree }) {
  const { t } = useTranslation("tree");
  const { session } = useAuth();
  const people = tree.persons ?? [];
  const kinship = useKinship(tree);
  const photos = useProfilePhotos(tree.id);
  const [view, setView] = useState<ViewMode>("list");

  const describe = (person: TreePerson) => {
    // A child the viewer may not see has no names: show a placeholder.
    const name = everydayName(person) ?? t("minor.name", { ns: "privacy" });
    // Shown under a nickname or "also known as" name, so people can tell who it is.
    const fullName = knownAs(person) ? primaryName(person) : null;
    const label = kinship.get(person.id);
    // The kinship word if there is one ("Uncle"), otherwise the description.
    const relation = label ? (label.term ?? label.description) : null;
    // Other names, leaving out the one already shown as the name.
    const aka = akaNames(person).filter((n) => n !== name);
    const isMe = person.claimed_by_user_id === session?.user.id;
    return { name, fullName, relation, aka, isMe, years: lifeYears(person) };
  };
  const open = (id: string) => router.push({ pathname: "/person/[id]", params: { id } });

  return (
    <View className="gap-1 rounded-xl bg-white p-4 dark:bg-gray-900">
      <View className="gap-2 pb-2">
        <View className="gap-0.5">
          <Text className="text-xl font-bold text-gray-900 dark:text-gray-100">{tree.name}</Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400">
            {t("home.peopleCount", { count: people.length })}
          </Text>
        </View>
        <Button
          label={t("open", { ns: "treeView" })}
          onPress={() => router.push({ pathname: "/tree/[id]", params: { id: tree.id } })}
        />
        <Button
          variant="link"
          label={t("recent", { ns: "history" })}
          onPress={() => router.push({ pathname: "/history/[treeId]", params: { treeId: tree.id } })}
        />
        <ChoiceChips
          label={t("home.viewLabel")}
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: t("home.list") },
            { value: "cards", label: t("home.cards") },
          ]}
        />
      </View>

      {view === "list" ? (
        people.map((person) => {
          const d = describe(person);
          const subtitle = [d.fullName, d.relation, d.aka.length ? t("home.aka", { names: d.aka.join(", ") }) : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <PersonRow
              key={person.id}
              name={d.name}
              subtitle={subtitle || null}
              badge={d.isMe ? t("home.you") : null}
              photo={photos.data?.get(person.id)}
              onPress={() => open(person.id)}
            />
          );
        })
      ) : (
        <View className="flex-row flex-wrap justify-between gap-y-3 pt-1">
          {people.map((person) => {
            const d = describe(person);
            return (
              <Pressable
                key={person.id}
                onPress={() => open(person.id)}
                accessibilityRole="button"
                className="w-[48%] items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-3 active:opacity-60 dark:border-gray-800 dark:bg-gray-950"
              >
                <Avatar name={d.name} photo={photos.data?.get(person.id)} size={56} />
                <Text numberOfLines={2} className="text-center text-base font-semibold text-gray-900 dark:text-gray-100">
                  {d.name}
                </Text>
                {d.fullName ? (
                  <Text numberOfLines={1} className="text-center text-xs text-gray-600 dark:text-gray-400">
                    {d.fullName}
                  </Text>
                ) : null}
                {d.aka.length ? (
                  <Text numberOfLines={1} className="text-center text-xs text-gray-600 dark:text-gray-400">
                    {t("home.aka", { names: d.aka.join(", ") })}
                  </Text>
                ) : null}
                {d.isMe || d.relation ? (
                  <Text numberOfLines={2} className="text-center text-sm text-indigo-700 dark:text-indigo-300">
                    {d.isMe ? t("home.you") : d.relation}
                  </Text>
                ) : null}
                {d.years ? <Text className="text-xs text-gray-500">{d.years}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
