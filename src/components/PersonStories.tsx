import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { inviteDate } from "@/components/InviteSection";
import { Button } from "@/components/ui/Button";
import { LANGUAGE_AUTONYMS } from "@/i18n/languages";
import { useAuth } from "@/lib/auth";
import type { PersonDetails } from "@/lib/people";
import { storyPermissions, useDeleteStory, useMemorial, useStories, type Story } from "@/lib/stories";
import { primaryName, useMyTrees } from "@/lib/trees";

/** The "Stories" section on a person's page. */
export function PersonStories({ person, name }: { person: PersonDetails; name: string }) {
  const { t, i18n } = useTranslation("stories");
  const { session } = useAuth();
  const stories = useStories(person.id);
  const memorial = useMemorial(person.id);
  const trees = useMyTrees();
  const perms = storyPermissions(person, memorial.data, session?.user.id);
  const list = stories.data ?? [];

  if (!perms.canWrite && list.length === 0) return null;

  const tree = trees.data?.find((x) => x.id === person.tree_id);
  const authorName = (story: Story) => {
    if (story.author && story.author === session?.user.id) return t("you");
    const p = tree?.persons.find((x) => x.claimed_by_user_id && x.claimed_by_user_id === story.author);
    return (p && primaryName(p)) ?? t("someone");
  };

  return (
    <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
      <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("title")}</Text>
      {list.length === 0 ? (
        <Text className="text-base text-gray-600 dark:text-gray-400">
          {perms.isMemorial ? t("noneMemorial", { name }) : t("none", { name })}
        </Text>
      ) : (
        list.map((story, index) => (
          <StoryItem
            key={story.id}
            story={story}
            first={index === 0}
            author={authorName(story)}
            date={inviteDate(story.created_at, i18n.language)}
            otherLanguage={story.lang !== i18n.language ? LANGUAGE_AUTONYMS[story.lang] : null}
            canEdit={perms.canEdit(story)}
            canDelete={perms.canDelete(story)}
          />
        ))
      )}
      {perms.canWrite ? (
        <Button
          variant="secondary"
          label={t("add")}
          onPress={() => router.push({ pathname: "/person/[id]/story", params: { id: person.id } })}
        />
      ) : null}
    </View>
  );
}

function StoryItem({
  story,
  first,
  author,
  date,
  otherLanguage,
  canEdit,
  canDelete,
}: {
  story: Story;
  first: boolean;
  author: string;
  date: string;
  otherLanguage: string | null;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { t } = useTranslation("stories");
  const remove = useDeleteStory(story.person_id);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <View className={`gap-1.5 pt-3 ${first ? "" : "border-t border-gray-100 dark:border-gray-800"}`}>
      {story.title ? (
        <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{story.title}</Text>
      ) : null}
      <Text selectable className="text-base leading-6 text-gray-800 dark:text-gray-200">
        {story.body}
      </Text>
      <Text className="text-sm text-gray-500">
        {t("by", { author, date })}
        {otherLanguage ? ` · ${t("writtenIn", { language: otherLanguage })}` : ""}
      </Text>
      {canEdit || canDelete ? (
        <View className="flex-row flex-wrap gap-x-4">
          {canEdit ? (
            <Button
              variant="link"
              label={t("edit")}
              onPress={() =>
                router.push({ pathname: "/person/[id]/story", params: { id: story.person_id, story: story.id } })
              }
            />
          ) : null}
          {canDelete && !confirming ? (
            <Button variant="link" label={t("delete")} onPress={() => setConfirming(true)} />
          ) : null}
        </View>
      ) : null}
      {confirming ? (
        <View className="gap-2">
          <Text className="text-base text-gray-900 dark:text-gray-100">{t("deleteConfirm")}</Text>
          <Button
            variant="danger"
            label={t("deleteYes")}
            loading={remove.isPending}
            onPress={() => remove.mutate(story.id, { onError: () => setError(t("deleteFailed")) })}
          />
          <Button variant="secondary" label={t("keep")} onPress={() => setConfirming(false)} />
        </View>
      ) : null}
      {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}
    </View>
  );
}
