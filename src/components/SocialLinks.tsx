import { useTranslation } from "react-i18next";
import { Linking, Pressable, Text, View } from "react-native";

import { TextField } from "@/components/ui/TextField";
import {
  PLATFORM_INPUT,
  PLATFORM_NAMES,
  SOCIAL_PLATFORMS,
  socialEntries,
  socialUrl,
  type SocialLinks,
  type SocialPlatform,
} from "@/lib/social";

function usePlatformName() {
  const { t } = useTranslation("privacy");
  return (p: SocialPlatform) => (p === "website" ? t("social.website") : PLATFORM_NAMES[p]);
}

/** Read-only list on a person's page: tap to open; WeChat IDs can be copied. */
export function SocialList({ links }: { links: SocialLinks | null | undefined }) {
  const { t } = useTranslation("privacy");
  const nameOf = usePlatformName();
  const entries = socialEntries(links);
  if (entries.length === 0) return null;
  return (
    <View className="gap-1 pt-1">
      {entries.map(([platform, value]) => {
        const url = socialUrl(platform, value);
        return (
          <View key={platform} className="flex-row flex-wrap items-baseline gap-x-2">
            <Text className="w-24 text-sm text-gray-500">{nameOf(platform)}</Text>
            {url ? (
              <Text
                accessibilityRole="link"
                className="shrink text-base text-indigo-700 dark:text-indigo-300"
                onPress={() => void Linking.openURL(url)}
              >
                {value}
              </Text>
            ) : (
              <Text
                selectable
                accessibilityHint={platform === "wechat" ? t("social.copyHint") : undefined}
                className="shrink text-base text-gray-900 dark:text-gray-100"
              >
                {value}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Editor: one field per platform in use, plus chips to add another. */
export function SocialEditor({ value, onChange }: { value: SocialLinks; onChange: (next: SocialLinks) => void }) {
  const { t } = useTranslation("privacy");
  const nameOf = usePlatformName();
  const used = SOCIAL_PLATFORMS.filter((p) => value[p] !== undefined);
  const unused = SOCIAL_PLATFORMS.filter((p) => value[p] === undefined);

  const set = (p: SocialPlatform, text: string) => onChange({ ...value, [p]: text });
  const remove = (p: SocialPlatform) => {
    const { [p]: _removed, ...rest } = value;
    onChange(rest);
  };

  return (
    <View className="gap-3">
      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{t("social.title")}</Text>
      {used.map((p) => (
        <View key={p} className="gap-1">
          <TextField
            label={nameOf(p)}
            value={value[p] ?? ""}
            onChangeText={(text) => set(p, text)}
            placeholder={t(`social.hint.${PLATFORM_INPUT[p]}`)}
            keyboardType={PLATFORM_INPUT[p] === "phone" ? "phone-pad" : PLATFORM_INPUT[p] === "url" ? "url" : "default"}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={200}
          />
          <Pressable onPress={() => remove(p)} accessibilityRole="button" className="self-end py-1">
            <Text className="text-sm text-red-600 dark:text-red-400">{t("social.remove", { platform: nameOf(p) })}</Text>
          </Pressable>
        </View>
      ))}
      {unused.length > 0 ? (
        <View className="gap-1.5">
          <Text className="text-sm text-gray-600 dark:text-gray-400">{t("social.add")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {unused.map((p) => (
              <Pressable
                key={p}
                onPress={() => set(p, "")}
                accessibilityRole="button"
                accessibilityLabel={`${t("social.add")}: ${nameOf(p)}`}
                className="min-h-10 justify-center rounded-full border border-gray-300 bg-white px-4 active:opacity-70 dark:border-gray-700 dark:bg-gray-900"
              >
                <Text className="text-sm text-gray-900 dark:text-gray-100">+ {nameOf(p)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
