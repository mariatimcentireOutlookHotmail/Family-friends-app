import { Pressable, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";

type Props = {
  name: string;
  /** Second line, e.g. "aka Michelle" or "Adoptive · Probably". */
  subtitle?: string | null;
  /** Small highlighted label, e.g. "You". */
  badge?: string | null;
  onPress?: () => void;
  first?: boolean;
  /** Profile photo thumbnail; the initial is shown without one. */
  photo?: { url: string; key: string } | null;
};

/** One person in a list: photo (or initial), name, optional details. Tappable. */
export function PersonRow({ name, subtitle, badge, onPress, first, photo }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className={`flex-row items-center gap-3 py-3 active:opacity-60 ${
        first ? "" : "border-t border-gray-100 dark:border-gray-800"
      }`}
    >
      <Avatar name={name} photo={photo} size={40} />
      <View className="flex-1">
        <Text className="text-base text-gray-900 dark:text-gray-100">{name}</Text>
        {subtitle ? <Text className="text-sm text-gray-600 dark:text-gray-400">{subtitle}</Text> : null}
      </View>
      {badge ? (
        <Text className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          {badge}
        </Text>
      ) : null}
      {onPress ? <Text className="text-lg text-gray-400">›</Text> : null}
    </Pressable>
  );
}
