import { Text, TextInput, View, type TextInputProps } from "react-native";

import { usePaletteColors } from "@/lib/theme";

type Props = Omit<TextInputProps, "className"> & {
  label: string;
  error?: string | null;
  /** Extra classes for the input, e.g. "text-center text-2xl". */
  inputClassName?: string;
};

export function TextField({ label, error, inputClassName = "", ...input }: Props) {
  const colors = usePaletteColors();
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.gray["400"]}
        className={`min-h-12 rounded-xl border bg-white px-4 text-base text-gray-900 dark:bg-gray-900 dark:text-gray-100 ${
          error ? "border-red-500" : "border-gray-300 dark:border-gray-700"
        } ${inputClassName}`}
        {...input}
      />
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
