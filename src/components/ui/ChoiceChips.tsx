import { Pressable, Text, View } from "react-native";

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label?: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** A row of tappable chips where exactly one is selected. */
export function ChoiceChips<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <View className="gap-1.5">
      {label ? (
        <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              className={`min-h-10 justify-center rounded-full border px-4 ${
                selected
                  ? "border-indigo-600 bg-indigo-600"
                  : "border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
              }`}
            >
              <Text className={selected ? "text-white" : "text-gray-900 dark:text-gray-100"}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
