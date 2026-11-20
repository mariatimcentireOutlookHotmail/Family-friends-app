import { ActivityIndicator, Pressable, Text } from "react-native";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "link";
  disabled?: boolean;
  loading?: boolean;
};

const CONTAINER = {
  primary: "bg-indigo-600 active:bg-indigo-700",
  secondary: "border border-gray-300 bg-white active:bg-gray-100 dark:border-gray-700 dark:bg-gray-900",
  danger: "bg-red-600 active:bg-red-700",
  link: "",
} as const;

const LABEL = {
  primary: "text-white",
  secondary: "text-gray-900 dark:text-gray-100",
  danger: "text-white",
  link: "text-indigo-600 dark:text-indigo-400",
} as const;

export function Button({ label, onPress, variant = "primary", disabled, loading }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-xl px-4 ${CONTAINER[variant]} ${
        inactive ? "opacity-50" : ""
      }`}
    >
      {loading ? <ActivityIndicator color={variant === "primary" || variant === "danger" ? "white" : undefined} /> : null}
      <Text className={`text-base font-semibold ${LABEL[variant]}`}>{label}</Text>
    </Pressable>
  );
}
