import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { isSupportedLanguage, type Language } from "@/i18n/languages";
import { useAuth } from "@/lib/auth";
import { usePerson } from "@/lib/people";
import {
  canManagePhoto,
  useDeletePhoto,
  usePhotos,
  useReplacePhoto,
  useSaveCaption,
  useSetProfilePhoto,
} from "@/lib/photos";
import { everydayName } from "@/lib/trees";

/**
 * One photo, large, with its caption; for those allowed: edit the caption,
 * make it the profile photo, replace it with another picture, or delete it.
 * A normal screen (not a pop-up), so it looks the same on every phone.
 */
export default function PhotoScreen() {
  const { t, i18n } = useTranslation("photos");
  const { id, person: personId } = useLocalSearchParams<{ id: string; person: string }>();
  const { session } = useAuth();
  const { height } = useWindowDimensions();
  const person = usePerson(personId);
  const photos = usePhotos(personId);
  const photo = photos.data?.find((p) => p.id === id);

  const setProfile = useSetProfilePhoto(personId);
  const remove = useDeletePhoto(personId);
  const saveCaption = useSaveCaption(personId);
  const replace = useReplacePhoto({ id: personId, tree_id: person.data?.tree_id ?? "" });

  const [caption, setCaption] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [broken, setBroken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lang: Language = isSupportedLanguage(i18n.language) ? i18n.language : "en";
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (person.isPending || photos.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }
  if (!person.data || !photo) {
    // Deleted or replaced: nothing left to show here.
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-gray-50 p-6 dark:bg-black">
        <Text className="text-base text-gray-700 dark:text-gray-300">{t("gone")}</Text>
        <Button variant="secondary" label={t("close")} onPress={back} />
      </View>
    );
  }

  const name = everydayName(person.data) ?? "";
  const manage = canManagePhoto(photo, person.data, session?.user.id);
  const captionValue = caption ?? photo.caption ?? "";
  const ratio = photo.width && photo.height ? photo.width / photo.height : 4 / 3;

  const replaceWith = (source: "library" | "camera") => {
    setError(null);
    replace.mutate(
      { old: photo, source, lang },
      {
        onSuccess: (result) => {
          if (result === "added") back();
          if (result === "noPermission") setError(t("noPermission"));
        },
        onError: (e) => {
          if (__DEV__) console.warn("[replace photo error]", e);
          setError(t("addFailed"));
        },
      },
    );
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-black" contentContainerClassName="items-center gap-4 p-4">
      <View
        className="w-full max-w-2xl items-center justify-center overflow-hidden rounded-xl bg-gray-900"
        style={{ maxHeight: height * 0.55 }}
      >
        {photo.url && !broken ? (
          <Image
            source={{ uri: photo.url, cacheKey: photo.path }}
            placeholder={photo.thumbUrl ? { uri: photo.thumbUrl, cacheKey: photo.thumb_path } : undefined}
            accessibilityLabel={photo.caption ?? t("photoOf", { name })}
            style={{ width: "100%", aspectRatio: ratio, maxHeight: height * 0.55 }}
            contentFit="contain"
            transition={200}
            onError={(e) => {
              if (__DEV__) console.warn("[photo] couldn't show", photo.path, e.error);
              setBroken(true);
            }}
          />
        ) : (
          <View className="h-40 w-full items-center justify-center p-4">
            <Text className="text-center text-sm text-gray-300">{t("cantShow")}</Text>
          </View>
        )}
      </View>

      <View className="w-full max-w-2xl gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
        {photo.is_profile ? (
          <Text className="text-sm text-indigo-700 dark:text-indigo-300">{t("isProfile")}</Text>
        ) : null}

        {manage ? (
          <>
            <TextField
              label={t("caption")}
              value={captionValue}
              onChangeText={setCaption}
              placeholder={t("captionHint")}
              multiline
              maxLength={500}
            />
            <Button
              variant="secondary"
              label={t("saveCaption")}
              loading={saveCaption.isPending}
              disabled={captionValue === (photo.caption ?? "")}
              onPress={() =>
                saveCaption.mutate(
                  { photoId: photo.id, caption: captionValue, lang },
                  { onSuccess: () => setCaption(null), onError: () => setError(t("saveFailed")) },
                )
              }
            />
            {!photo.is_profile ? (
              <Button
                variant="secondary"
                label={t("makeProfile")}
                loading={setProfile.isPending}
                onPress={() => setProfile.mutate(photo.id, { onError: () => setError(t("saveFailed")) })}
              />
            ) : null}
            <Button
              label={replace.isPending ? t("replacing") : t("replace")}
              loading={replace.isPending}
              onPress={() => replaceWith("library")}
            />
            {Platform.OS !== "web" ? (
              <Button
                variant="secondary"
                label={t("replaceCamera")}
                disabled={replace.isPending}
                onPress={() => replaceWith("camera")}
              />
            ) : null}
            {!confirming ? (
              <Button variant="danger" label={t("delete")} onPress={() => setConfirming(true)} />
            ) : (
              <View className="gap-2">
                <Text className="text-base text-gray-900 dark:text-gray-100">{t("deleteConfirm")}</Text>
                <Button
                  variant="danger"
                  label={t("deleteYes")}
                  loading={remove.isPending}
                  onPress={() =>
                    remove.mutate(photo, {
                      onSuccess: back,
                      onError: () => setError(t("deleteFailed")),
                    })
                  }
                />
                <Button variant="secondary" label={t("keep")} onPress={() => setConfirming(false)} />
              </View>
            )}
          </>
        ) : (
          <>
            {photo.caption ? (
              <Text className="text-base text-gray-900 dark:text-gray-100">{photo.caption}</Text>
            ) : null}
            <Text className="text-sm text-gray-600 dark:text-gray-400">{t("whoCanChange")}</Text>
          </>
        )}

        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
