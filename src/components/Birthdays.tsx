import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch, Text, View } from "react-native";

import { PersonRow } from "@/components/PersonRow";
import { useAuth } from "@/lib/auth";
import { upcomingBirthdays, type BirthdayRow } from "@/lib/birthdays";
import { formatDate } from "@/lib/dates";
import {
  remindersEnabled,
  remindersSupported,
  scheduleBirthdayReminders,
  setRemindersEnabled,
} from "@/lib/reminders";
import { supabase } from "@/lib/supabase";
import { useProfilePhotos } from "@/lib/photos";
import { everydayName, useMyTrees, type TreePerson } from "@/lib/trees";

/** Days ahead shown on the home screen, and planned as reminders. */
const SHOW_DAYS = 30;
const REMIND_DAYS = 60;

function useBirthdayRows() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["birthdays", session?.user.id],
    enabled: Boolean(session),
    queryFn: async (): Promise<BirthdayRow[]> => {
      const { data, error } = await supabase.rpc("my_birthdays");
      if (error) throw error;
      return (data ?? []) as BirthdayRow[];
    },
  });
}

/** "Upcoming birthdays" on the home screen, plus the reminder switch. */
export function Birthdays() {
  const { t, i18n } = useTranslation("birthdays");
  const rows = useBirthdayRows();
  const trees = useMyTrees();
  const firstTree = trees.data?.[0]?.id;
  const photos = useProfilePhotos(firstTree);
  const [remind, setRemind] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void remindersEnabled().then(setRemind);
  }, []);

  const treeData = trees.data;
  const personOf = useMemo(() => {
    const map = new Map<string, TreePerson>();
    for (const tree of treeData ?? []) for (const p of tree.persons) map.set(p.id, p);
    return map;
  }, [treeData]);

  const nameOf = (id: string) => {
    const p = personOf.get(id);
    return (p && everydayName(p)) ?? t("someone");
  };

  const today = new Date();
  const upcoming = upcomingBirthdays(rows.data ?? [], today, SHOW_DAYS);

  // Keep this phone's reminders in step with the birthdays (when switched on).
  const planKey = JSON.stringify([remind, rows.data, i18n.language, personOf.size]);
  useEffect(() => {
    if (!remind || !rows.data) return;
    const items = upcomingBirthdays(rows.data, new Date(), REMIND_DAYS).map((b) => ({
      personId: b.person_id,
      date: b.date,
      title: t("notification.title"),
      body:
        b.turning !== null
          ? t("notification.bodyAge", { name: nameOf(b.person_id), age: b.turning })
          : t("notification.body", { name: nameOf(b.person_id) }),
    }));
    void scheduleBirthdayReminders(items);
    // planKey covers everything the reminders depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const toggle = async (on: boolean) => {
    setNotice(null);
    const result = await setRemindersEnabled(on, t("channel"));
    if (result === "denied") {
      setRemind(false);
      setNotice(t("denied"));
    } else {
      setRemind(result === "on");
      setNotice(result === "on" ? t("turnedOn") : null);
    }
  };

  if (!rows.data && !remindersSupported) return null;

  const when = (daysAway: number, date: Date) => {
    const label = formatDate(
      { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), qualifier: "exact" },
      i18n.language,
    );
    if (daysAway === 0) return t("today");
    if (daysAway === 1) return t("tomorrow");
    return t("inDays", { count: daysAway, date: label });
  };

  return (
    <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
      <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("title")}</Text>
      {upcoming.length === 0 ? (
        <Text className="text-base text-gray-600 dark:text-gray-400">{t("none", { days: SHOW_DAYS })}</Text>
      ) : (
        <View>
          {upcoming.map((b, index) => (
            <PersonRow
              key={b.person_id}
              first={index === 0}
              name={nameOf(b.person_id)}
              photo={photos.data?.get(b.person_id)}
              subtitle={[when(b.daysAway, b.date), b.turning !== null ? t("turns", { age: b.turning }) : null]
                .filter(Boolean)
                .join(" · ")}
              onPress={() => router.push({ pathname: "/person/[id]", params: { id: b.person_id } })}
            />
          ))}
        </View>
      )}
      <Text className="text-xs text-gray-500">{t("privacyNote")}</Text>
      {remindersSupported ? (
        <View className="flex-row items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          <View className="flex-1">
            <Text className="text-base text-gray-900 dark:text-gray-100">{t("remind")}</Text>
            <Text className="text-xs text-gray-500">{t("remindHint")}</Text>
          </View>
          <Switch value={remind} onValueChange={(v) => void toggle(v)} accessibilityLabel={t("remind")} />
        </View>
      ) : null}
      {notice ? <Text className="text-sm text-gray-700 dark:text-gray-300">{notice}</Text> : null}
    </View>
  );
}
