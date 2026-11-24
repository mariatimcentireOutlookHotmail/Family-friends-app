import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";

type Props = {
  name: string;
  /** Profile photo thumbnail, if there is one. */
  photo?: { url: string; key: string } | null;
  size: number;
};

/** A round profile photo, or the first letter of the name when there is none. */
export function Avatar({ name, photo, size }: Props) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return (
      <Image
        source={{ uri: photo.url, cacheKey: photo.key }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <View
      className="items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900"
      style={{ width: size, height: size }}
    >
      <Text
        className="font-semibold text-indigo-700 dark:text-indigo-200"
        style={{ fontSize: Math.round(size * 0.4) }}
      >
        {Array.from(name)[0] ?? "?"}
      </Text>
    </View>
  );
}
