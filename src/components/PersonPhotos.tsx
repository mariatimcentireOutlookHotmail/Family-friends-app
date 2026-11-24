import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { isSupportedLanguage, type Language } from "@/i18n/languages";
import { useAuth } from "@/lib/auth";
import type { PersonDetails } from "@/lib/people";
import {
  canAddPhotos,
  useAddPhoto,
  usePhotos,
} from "@/lib/photos";


/** Opens a photo on its own screen (to see it large, caption, replace or delete). */
export const openPhoto = (personId: string, photoId: string) =>
  router.push({ pathname: "/photo/[id]", params: { id: photoId, person: personId } });

/**
 * The round profile photo at the top of a person's page (nothing if none).
 * Tap it to open it, like any other photo: to change, replace or delete it.
 */
export function ProfilePhoto({ personId, name }: { personId: string; name: string }) {
  const { t } = useTranslation("photos");
  const photos = usePhotos(personId);
  const [broken, setBroken] = useState(false);
  const profile = photos.data?.find((p) => p.is_profile);
  if (!profile) return null;
  return (
    <Pressable
      onPress={() => openPhoto(personId, profile.id)}
      accessibilityRole="imagebutton"
      accessibilityLabel={t("profileOf", { name })}
      accessibilityHint={t("openHint")}
      className="self-start overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
      style={{ width: 112, height: 112 }}
    >
      {profile.thumbUrl && !broken ? (
        <Image
          source={{ uri: profile.thumbUrl, cacheKey: profile.thumb_path }}
          style={{ width: 112, height: 112 }}
          contentFit="cover"
          transition={150}
          onError={() => setBroken(true)}
        />
      ) : (
        <View className="flex-1 items-center justify-center p-2">
          <Text className="text-center text-xs text-gray-600 dark:text-gray-400">{t("cantShow")}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** The "Photos" section: thumbnails, adding, and a full-screen viewer. */
export function PersonPhotos({
  person,
  name,
}: {
  person: PersonDetails;
  name: string;
}) {
  const { t, i18n } = useTranslation("photos");
  const { session } = useAuth();
  const photos = usePhotos(person.id);
  const add = useAddPhoto(person);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const lang: Language = isSupportedLanguage(i18n.language) ? i18n.language : "en";

  const list = photos.data ?? [];
  const mayAdd = canAddPhotos(person, session?.user.id);
  if (!mayAdd && list.length === 0) return null;

  const addFrom = (source: "library" | "camera") => {
    setMessage(null);
    setNotice(null);
    add.mutate(
      { source, lang },
      {
        onSuccess: (result) => {
          if (result === "noPermission") setMessage(t("noPermission"));
          if (result === "added") setNotice(t("added"));
        },
        onError: (e) => {
          if (__DEV__) console.warn("[add photo error]", e);
          setMessage(`${t("addFailed")} (${e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)})`);
        },
      },
    );
  };

  return (
    <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
      <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("title")}</Text>
      {photos.isError ? (
        <View className="gap-2">
          <Text className="text-sm text-red-600 dark:text-red-400">{t("loadFailed")}</Text>
          <Button variant="secondary" label={t("retry")} onPress={() => void photos.refetch()} />
        </View>
      ) : list.length === 0 ? (
        <Text className="text-base text-gray-600 dark:text-gray-400">{t("none", { name })}</Text>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {list.map((photo) => (
            <Pressable
              key={photo.id}
              onPress={() => openPhoto(person.id, photo.id)}
              accessibilityRole="imagebutton"
              accessibilityLabel={photo.caption ?? t("photoOf", { name })}
              className="overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
              style={{ width: 96, height: 96 }}
            >
              {photo.thumbUrl && !broken[photo.id] ? (
                <Image
                  source={{ uri: photo.thumbUrl, cacheKey: photo.thumb_path }}
                  style={{ width: 96, height: 96 }}
                  contentFit="cover"
                  transition={150}
                  onError={(e) => {
                    if (__DEV__) console.warn("[photo] couldn't show", photo.thumb_path, e.error);
                    setBroken((b) => ({ ...b, [photo.id]: true }));
                  }}
                />
              ) : (
                <View className="flex-1 items-center justify-center p-1">
                  <Text className="text-center text-[11px] text-gray-600 dark:text-gray-400">{t("cantShow")}</Text>
                </View>
              )}
              {photo.is_profile ? (
                <Text className="absolute bottom-1 left-1 rounded bg-indigo-600 px-1 text-[10px] font-semibold text-white">
                  {t("profileBadge")}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      {mayAdd ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            variant="secondary"
            label={add.isPending ? t("adding") : t("addFromLibrary")}
            loading={add.isPending}
            onPress={() => addFrom("library")}
          />
          {Platform.OS !== "web" ? (
            <Button variant="secondary" label={t("takePhoto")} disabled={add.isPending} onPress={() => addFrom("camera")} />
          ) : null}
        </View>
      ) : null}
      {notice ? <Text className="text-sm text-green-700 dark:text-green-400">{notice}</Text> : null}
      {message ? (
        <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
          {message}
        </Text>
      ) : null}

    </View>
  );
}
