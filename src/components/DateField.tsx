import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { TextField } from "@/components/ui/TextField";
import {
  draftToDate,
  emptyDateDraft,
  validateDate,
  validateLifeDates,
  type DateDraft,
  type DateErrorKey,
  type Qualifier,
} from "@/lib/dates";

const QUALIFIERS: Qualifier[] = ["exact", "about", "before", "after"];

type Props = {
  label: string;
  value: DateDraft;
  onChange: (next: DateDraft) => void;
  error?: string | null;
  /** Show the "day and month are kept" note (viewer can't see them). */
  hiddenKept?: boolean;
  showHint?: boolean;
};

/** A partial date: year, month and day (each optional), plus how exact it is. */
export function DateField({ label, value, onChange, error, hiddenKept, showHint }: Props) {
  const { t } = useTranslation("dates");
  const digits = (s: string) => s.replace(/[^\d]/g, "");
  const filled = Boolean(value.year || value.month || value.day);

  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</Text>
      <View className="flex-row gap-2">
        <View className="flex-[2]">
          <TextField
            label={t("fields.year")}
            placeholder={t("fields.yearPlaceholder")}
            value={value.year}
            onChangeText={(year) => onChange({ ...value, year: digits(year) })}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={4}
          />
        </View>
        <View className="flex-1">
          <TextField
            label={t("fields.month")}
            placeholder={t("fields.monthPlaceholder")}
            value={value.month}
            onChangeText={(month) => onChange({ ...value, month: digits(month) })}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={2}
          />
        </View>
        <View className="flex-1">
          <TextField
            label={t("fields.day")}
            placeholder={t("fields.dayPlaceholder")}
            value={value.day}
            onChangeText={(day) => onChange({ ...value, day: digits(day) })}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={2}
          />
        </View>
      </View>

      {value.year ? (
        <ChoiceChips
          label={t("fields.qualifierLabel")}
          value={value.qualifier}
          onChange={(qualifier) => onChange({ ...value, qualifier })}
          options={QUALIFIERS.map((q) => ({ value: q, label: t(`qualifiers.${q}`) }))}
        />
      ) : null}

      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </Text>
      ) : null}
      {hiddenKept ? <Text className="text-sm text-gray-600 dark:text-gray-400">{t("fields.hiddenKept")}</Text> : null}
      {showHint && !hiddenKept ? (
        <Text className="text-sm text-gray-600 dark:text-gray-400">{t("fields.hint")}</Text>
      ) : null}
      {filled ? <Button variant="link" label={t("fields.clear")} onPress={() => onChange(emptyDateDraft)} /> : null}
    </View>
  );
}

/** Check a birth date and (optionally) a death date from the form fields. */
export function checkDates(
  birth: DateDraft,
  death: DateDraft | null,
): { birth: DateErrorKey | null; death: DateErrorKey | null } {
  const b = draftToDate(birth);
  const d = death ? draftToDate(death) : null;
  const birthError = validateDate(b);
  const deathError = (d ? validateDate(d) : null) ?? (birthError ? null : validateLifeDates(b, d));
  return { birth: birthError, death: deathError };
}
