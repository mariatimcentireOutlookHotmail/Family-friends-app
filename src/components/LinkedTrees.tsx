import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { inviteDate } from "@/components/InviteSection";
import { Button } from "@/components/ui/Button";
import {
  relationKey,
  usePendingLinkCode,
  usePersonLinks,
  useRevokeLinkCode,
  useUnlink,
  type LinkedCard,
  type PersonLink,
} from "@/lib/treeLinks";

const years = (c: LinkedCard) =>
  c.birthYear && c.deathYear ? `${c.birthYear}–${c.deathYear}` : c.birthYear ? `${c.birthYear}` : c.deathYear ? `–${c.deathYear}` : null;

/** "Bud (Wong Budi) · 1983" */
function cardText(c: LinkedCard): string {
  const name = c.nickname ? `${c.nickname} (${c.name ?? ""})` : (c.name ?? "—");
  return [name, years(c)].filter(Boolean).join(" · ");
}

/**
 * On a person's page: their versions in other families' trees, with close
 * family; and, for owners, linking and unlinking.
 */
export function LinkedTrees({ personId, name, isOwner }: { personId: string; name: string; isOwner: boolean }) {
  const { t } = useTranslation("links");
  const links = usePersonLinks(personId);
  const list = links.data ?? [];

  if (!isOwner && list.length === 0) return null;

  return (
    <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
      <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("section.title")}</Text>
      {list.map((link) => (
        <LinkCard key={link.linkId} link={link} personId={personId} name={name} />
      ))}
      {list.length > 0 ? (
        <Text className="text-xs text-gray-500">{t("section.namesOnly")}</Text>
      ) : (
        <Text className="text-base text-gray-700 dark:text-gray-300">{t("section.explain", { name })}</Text>
      )}
      {isOwner ? <LinkCodeControls personId={personId} /> : null}
    </View>
  );
}

function LinkCard({ link, personId, name }: { link: PersonLink; personId: string; name: string }) {
  const { t } = useTranslation("links");
  const unlink = useUnlink(personId);
  const [asking, setAsking] = useState(false);
  return (
    <View className="gap-1.5 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <Text className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
        {t("section.alsoIn", { tree: link.treeName })}
      </Text>
      {link.person ? <Text className="text-base text-gray-900 dark:text-gray-100">{cardText(link.person)}</Text> : null}
      {link.family.map((f) => (
        <View key={f.id} className="flex-row flex-wrap gap-x-2">
          <Text className="w-28 text-sm text-gray-500">{t(`relation.${relationKey(f.relation, f.sex)}` as never)}</Text>
          <Text className="shrink text-sm text-gray-800 dark:text-gray-200">{cardText(f)}</Text>
        </View>
      ))}
      {link.canUnlink && !asking ? (
        <View className="items-start">
          <Button variant="link" label={t("section.unlink")} onPress={() => setAsking(true)} />
        </View>
      ) : null}
      {asking ? (
        <View className="gap-2 pt-1">
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{t("section.unlinkTitle")}</Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400">{t("section.unlinkExplain", { name })}</Text>
          <Button
            variant="danger"
            label={unlink.isPending ? t("section.unlinking") : t("section.unlinkConfirm")}
            loading={unlink.isPending}
            onPress={() => unlink.mutate(link.linkId)}
          />
          <Button variant="secondary" label={t("section.keep")} onPress={() => setAsking(false)} />
        </View>
      ) : null}
    </View>
  );
}

function LinkCodeControls({ personId }: { personId: string }) {
  const { t, i18n } = useTranslation("links");
  const pending = usePendingLinkCode(personId, true);
  const revoke = useRevokeLinkCode(personId);
  const open = () => router.push({ pathname: "/person/[id]/link-tree", params: { id: personId } });
  if (pending.data) {
    return (
      <View className="gap-2">
        <Text className="text-sm text-gray-700 dark:text-gray-300">
          {t("section.pending", {
            sent: inviteDate(pending.data.createdAt, i18n.language),
            expires: inviteDate(pending.data.expiresAt, i18n.language),
          })}
        </Text>
        <Button variant="secondary" label={t("section.newCode")} onPress={open} />
        <Button
          variant="link"
          label={t("section.cancel")}
          loading={revoke.isPending}
          onPress={() => revoke.mutate(pending.data!.id)}
        />
      </View>
    );
  }
  return <Button variant="secondary" label={t("section.button")} onPress={open} />;
}
