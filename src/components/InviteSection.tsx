import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/dates";
import { inviteErrorKey, usePendingInvite, useRevokeInvite } from "@/lib/invites";

/** "2026-12-04T10:00:00Z" → a date in the UI language. */
export function inviteDate(iso: string, language: string): string {
  const d = new Date(iso);
  return formatDate(
    { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), qualifier: "exact" },
    language,
  );
}

/** On a person's page: invite them, or see and cancel the open invite. */
export function InviteSection({ personId, name }: { personId: string; name: string }) {
  const { t, i18n } = useTranslation("invite");
  const pending = usePendingInvite(personId, true);
  const revoke = useRevokeInvite(personId);
  const openInvite = () => router.push({ pathname: "/person/[id]/invite", params: { id: personId } });

  return (
    <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
      <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("section.title", { name })}</Text>
      {pending.data ? (
        <>
          <Text className="text-base text-gray-700 dark:text-gray-300">
            {t("section.pending", {
              sent: inviteDate(pending.data.created_at, i18n.language),
              expires: inviteDate(pending.data.expires_at, i18n.language),
            })}
          </Text>
          <Button variant="secondary" label={t("section.newCode")} onPress={openInvite} />
          <Button
            variant="link"
            label={t("section.cancel")}
            loading={revoke.isPending}
            onPress={() => revoke.mutate(pending.data!.id)}
          />
        </>
      ) : (
        <>
          <Text className="text-base text-gray-700 dark:text-gray-300">{t("section.body", { name })}</Text>
          <Button label={t("section.button", { name })} onPress={openInvite} />
        </>
      )}
      {revoke.isSuccess && !pending.data ? (
        <Text className="text-sm text-gray-600 dark:text-gray-400">{t("section.cancelled")}</Text>
      ) : null}
      {revoke.isError ? (
        <Text className="text-sm text-red-600 dark:text-red-400">{t(`errors.${inviteErrorKey(revoke.error)}`)}</Text>
      ) : null}
    </View>
  );
}
