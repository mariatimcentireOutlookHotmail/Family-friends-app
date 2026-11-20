import { useTranslation } from "react-i18next";
import { Switch, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { TextField } from "@/components/ui/TextField";
import { detectScript, formatFullName, isFamilyFirstByDefault } from "@/lib/names";
import type { NameType } from "@/lib/trees";

export type NameDraft = {
  key: string; // stable id for the list, not saved
  given: string;
  family: string;
  familyFirst: boolean;
  /** True once the user flips "family name first" themselves. */
  familyFirstTouched: boolean;
  type: NameType;
};

export function emptyName(key: string): NameDraft {
  return { key, given: "", family: "", familyFirst: false, familyFirstTouched: false, type: "birth" };
}

const NAME_TYPES: NameType[] = ["birth", "married", "nickname", "religious", "other"];

type Props = {
  value: NameDraft;
  onChange: (next: NameDraft) => void;
  isMain: boolean;
  onRemove?: () => void;
  error?: string | null;
};

/** Edits one name: given + family parts, display order, and kind of name. */
export function NameEditor({ value, onChange, isMain, onRemove, error }: Props) {
  const { t } = useTranslation("tree");

  // Until the user decides, follow the script: Chinese → family name first.
  const update = (patch: Partial<NameDraft>) => {
    const next = { ...value, ...patch };
    if (!next.familyFirstTouched) {
      next.familyFirst = isFamilyFirstByDefault(detectScript(next.given, next.family));
    }
    onChange(next);
  };

  const preview = formatFullName(value);

  return (
    <View className="gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
        {isMain ? t("names.mainName") : t("names.otherName")}
      </Text>

      <TextField
        label={t("names.givenLabel")}
        value={value.given}
        onChangeText={(given) => update({ given })}
        autoComplete={isMain ? "given-name" : "off"}
        textContentType={isMain ? "givenName" : "none"}
        error={error}
      />
      <TextField
        label={t("names.familyLabel")}
        value={value.family}
        onChangeText={(family) => update({ family })}
        autoComplete={isMain ? "family-name" : "off"}
        textContentType={isMain ? "familyName" : "none"}
      />

      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-sm text-gray-900 dark:text-gray-100">{t("names.familyFirst")}</Text>
        <Switch
          value={value.familyFirst}
          onValueChange={(familyFirst) => onChange({ ...value, familyFirst, familyFirstTouched: true })}
          accessibilityLabel={t("names.familyFirst")}
        />
      </View>

      {preview ? (
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          {t("names.shownAs", { name: preview })}
        </Text>
      ) : null}

      {!isMain ? (
        <>
          <ChoiceChips
            label={t("names.typeLabel")}
            value={value.type}
            onChange={(type) => onChange({ ...value, type })}
            options={NAME_TYPES.map((type) => ({ value: type, label: t(`nameTypes.${type}`) }))}
          />
          {onRemove ? <Button variant="link" label={t("names.remove")} onPress={onRemove} /> : null}
        </>
      ) : null}
    </View>
  );
}
