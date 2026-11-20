import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { ageFrom, eventToDate, formatDate, hasHiddenParts, type LifeEvent, type PartialDate } from "@/lib/dates";

/** "Born 14 March 1952 · 74 years old" / "Died about 2001", in the UI language. */
export function LifeDates({ events, living }: { events: LifeEvent[]; living: "living" | "deceased" | "unknown" }) {
  const { t, i18n } = useTranslation("dates");
  const birth = events.find((e) => e.type === "birth");
  const death = events.find((e) => e.type === "death");
  if (!birth && !death) return null;

  const show = (d: PartialDate) => {
    const date = formatDate(d, i18n.language);
    return d.qualifier === "exact" ? date : t(`display.${d.qualifier}`, { date });
  };

  const birthDate = birth ? eventToDate(birth) : null;
  const age = birthDate && living !== "deceased" ? ageFrom(birthDate) : null;

  return (
    <View className="gap-0.5">
      {birthDate ? (
        <Text className="text-base text-gray-700 dark:text-gray-300">
          {t("display.born", { date: show(birthDate) })}
          {age ? ` · ${age.approximate ? t("display.ageAbout", { age: age.age }) : t("display.age", { age: age.age })}` : ""}
        </Text>
      ) : null}
      {birth && hasHiddenParts(birth) ? (
        <Text className="text-sm text-gray-500 dark:text-gray-400">{t("display.hiddenNote")}</Text>
      ) : null}
      {death ? (
        <Text className="text-base text-gray-700 dark:text-gray-300">
          {t("display.died", { date: show(eventToDate(death)) })}
        </Text>
      ) : null}
    </View>
  );
}
