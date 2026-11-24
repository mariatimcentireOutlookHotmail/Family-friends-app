import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import type { Language } from "@/i18n/languages";

import { useAuth } from "./auth";
import { supabase, supabaseConfig } from "./supabase";

/**
 * Photos of a person. Files are in the private "media" bucket; the rules are
 * in supabase/migrations/20261121000000_photos.sql. Every photo is stored
 * twice: full size (longest side ≤ 1600 px) and a thumbnail (≤ 400 px), both
 * JPEG, resized on the phone before uploading to keep within the free tier.
 */

const BUCKET = "media";
const FULL_SIZE = 1600;
const THUMB_SIZE = 400;
/** Signed links last an hour; the list is refetched well before then. */
const LINK_SECONDS = 60 * 60;

export type Photo = {
  id: string;
  person_id: string;
  tree_id: string;
  path: string;
  thumb_path: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  lang: Language | null;
  is_profile: boolean;
  uploaded_by: string | null;
  created_at: string;
  /** Short-lived links to the files. */
  url: string | null;
  thumbUrl: string | null;
};

export const photosKey = (personId: string) => ["photos", personId] as const;

/** All photos of a person the viewer may see, profile photo first. */
export function usePhotos(personId: string) {
  return useQuery({
    queryKey: photosKey(personId),
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Photo[]> => {
      const { data, error } = await supabase
        .from("media")
        .select("id, person_id, tree_id, path, thumb_path, width, height, caption, lang, is_profile, uploaded_by, created_at")
        .eq("person_id", personId)
        .order("is_profile", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Omit<Photo, "url" | "thumbUrl">[];
      if (rows.length === 0) return [];
      const files = rows.flatMap((r) => [r.path, r.thumb_path]);
      const { data: links, error: linkError } = await supabase.storage.from(BUCKET).createSignedUrls(files, LINK_SECONDS);
      // Still list the photos if the links fail; the screen shows which can't load.
      if (linkError && __DEV__) console.warn("[photo] links failed", linkError);
      const urlOf = new Map((links ?? []).map((l) => [l.path, l.signedUrl]));
      return rows.map((r) => ({ ...r, url: urlOf.get(r.path) ?? null, thumbUrl: urlOf.get(r.thumb_path) ?? null }));
    },
  });
}

export const profilePhotosKey = (treeId: string) => ["profile-photos", treeId] as const;

/**
 * Profile photo thumbnails for everyone in a tree (that the viewer may see),
 * as person id → short-lived link. Used by lists, cards and the tree view.
 */
export function useProfilePhotos(treeId: string | undefined) {
  return useQuery({
    queryKey: profilePhotosKey(treeId ?? ""),
    enabled: Boolean(treeId),
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Map<string, { url: string; key: string }>> => {
      const { data, error } = await supabase
        .from("media")
        .select("person_id, thumb_path")
        .eq("tree_id", treeId!)
        .eq("is_profile", true);
      if (error) throw error;
      const rows = (data ?? []) as { person_id: string; thumb_path: string }[];
      if (rows.length === 0) return new Map();
      const { data: links } = await supabase.storage.from(BUCKET).createSignedUrls(
        rows.map((r) => r.thumb_path),
        LINK_SECONDS,
      );
      const urlOf = new Map((links ?? []).map((l) => [l.path, l.signedUrl]));
      const out = new Map<string, { url: string; key: string }>();
      for (const r of rows) {
        const url = urlOf.get(r.thumb_path);
        if (url) out.set(r.person_id, { url, key: r.thumb_path });
      }
      return out;
    },
  });
}

/** A random id for a new photo (also its file name). */
function newPhotoId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback (older runtimes): a version-4 style id from Math.random. It only
  // names a file in a folder the viewer is allowed to write to.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Resize so the longest side is at most `max` px, as JPEG. */
async function resized(uri: string, width: number, height: number, max: number) {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > max) {
    ctx.resize(width >= height ? { width: max } : { height: max });
  }
  const image = await ctx.renderAsync();
  return image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
}

/**
 * Upload one JPEG file.
 *
 * On phones the file is sent straight from disk by the native uploader.
 * (Reading it into JavaScript first with fetch(...).arrayBuffer() doesn't work
 * on Android: it uploaded a 14-byte scrap instead of the picture.)
 * In the browser the picture is already in memory, so it goes through the
 * normal Supabase client.
 */
async function upload(path: string, fileUri: string) {
  if (Platform.OS === "web") {
    const body = await (await fetch(fileUri)).arrayBuffer();
    trace("uploading", { path, bytes: body.byteLength });
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: "image/jpeg", upsert: false });
    if (error) throw error;
    return;
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const url = `${supabaseConfig.url}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  trace("uploading", { path });
  const res = await uploadAsync(url, fileUri, {
    httpMethod: "POST",
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseConfig.key,
      "Content-Type": "image/jpeg",
      "x-upsert": "false",
      "cache-control": "3600",
    },
  });
  trace("upload response", { status: res.status });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Upload failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
}

export type AddPhotoResult = "added" | "cancelled" | "noPermission";

/** Step-by-step log while developing (shows in the `npx expo start` terminal). */
const trace = (step: string, detail?: unknown) => {
  if (__DEV__) console.log(`[photo] ${step}`, detail ?? "");
};

/**
 * Pick a photo (library or camera), resize, upload both sizes and record it.
 * Returns the new photo's id, or why nothing was added.
 */
async function pickAndUpload(
  person: { id: string; tree_id: string },
  source: "library" | "camera",
  lang: Language,
  isProfile: boolean,
  userId: string | undefined,
): Promise<{ id: string } | "cancelled" | "noPermission"> {
  const permission =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  trace("permission", { granted: permission.granted, source });
  if (!permission.granted) return "noPermission";

  // After picking, phones open their crop screen so the background can be cut
  // away: avatars are tiny, so a close crop on the face shows much better.
  // Android: free-form crop and rotate. iOS: square crop. The browser has no
  // crop screen, so there the picture is used as picked.
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 1,
    allowsEditing: Platform.OS !== "web",
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  trace("picked", { canceled: result.canceled, assets: result.assets?.length ?? 0 });
  if (result.canceled || !result.assets[0]) return "cancelled";
  const asset = result.assets[0];
  trace("asset", { width: asset.width, height: asset.height, type: asset.mimeType });

  const full = await resized(asset.uri, asset.width, asset.height, FULL_SIZE);
  const thumb = await resized(asset.uri, asset.width, asset.height, THUMB_SIZE);
  trace("resized", { full: [full.width, full.height], thumb: [thumb.width, thumb.height] });

  const id = newPhotoId();
  const path = `${person.tree_id}/${person.id}/${id}.jpg`;
  const thumbPath = `${person.tree_id}/${person.id}/${id}_thumb.jpg`;
  await upload(path, full.uri);
  await upload(thumbPath, thumb.uri);
  trace("uploaded", path);

  const { error } = await supabase.from("media").insert({
    id,
    person_id: person.id,
    tree_id: person.tree_id,
    path,
    thumb_path: thumbPath,
    width: full.width,
    height: full.height,
    lang,
    is_profile: isProfile,
    uploaded_by: userId,
  });
  if (error) {
    // Don't leave files nobody can see.
    await supabase.storage.from(BUCKET).remove([path, thumbPath]);
    throw error;
  }
  trace("saved", id);
  return { id };
}

/**
 * Lets the person pick a photo (library or camera), then resizes, uploads and
 * records it. The database makes it the profile photo if there is none.
 */
export function useAddPhoto(person: { id: string; tree_id: string }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ source, lang }: { source: "library" | "camera"; lang: Language }): Promise<AddPhotoResult> => {
      // The database makes it the profile photo if the person has none yet.
      const result = await pickAndUpload(person, source, lang, false, session?.user.id);
      return typeof result === "string" ? result : "added";
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: photosKey(person.id) });
      void queryClient.invalidateQueries({ queryKey: ["profile-photos"] });
    },
  });
}

/**
 * Swap a photo for a different picture: the new one takes over the caption
 * and, if it was the profile photo, that role; then the old one is deleted.
 */
export function useReplacePhoto(person: { id: string; tree_id: string }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ old, source, lang }: { old: Photo; source: "library" | "camera"; lang: Language }): Promise<AddPhotoResult> => {
      const result = await pickAndUpload(person, source, old.lang ?? lang, false, session?.user.id);
      if (typeof result === "string") return result;
      if (old.caption) {
        const { error } = await supabase.from("media").update({ caption: old.caption }).eq("id", result.id);
        if (error) throw error;
      }
      if (old.is_profile) {
        const { error } = await supabase.rpc("set_profile_photo", { p_media: result.id });
        if (error) throw error;
      }
      await deletePhoto(old);
      return "added";
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: photosKey(person.id) });
      void queryClient.invalidateQueries({ queryKey: ["profile-photos"] });
    },
  });
}

async function deletePhoto(photo: Photo) {
  // Files first: the file rules check the photo's row, which must still exist.
  const { error: fileError } = await supabase.storage.from(BUCKET).remove([photo.path, photo.thumb_path]);
  if (fileError) throw fileError;
  const { error, count } = await supabase.from("media").delete({ count: "exact" }).eq("id", photo.id);
  if (error) throw error;
  if (count === 0) throw new Error("not allowed");
}

export function useDeletePhoto(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: photosKey(personId) });
      void queryClient.invalidateQueries({ queryKey: ["profile-photos"] });
    },
  });
}

export function useSetProfilePhoto(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (photoId: string) => {
      const { error } = await supabase.rpc("set_profile_photo", { p_media: photoId });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: photosKey(personId) });
      void queryClient.invalidateQueries({ queryKey: ["profile-photos"] });
    },
  });
}

export function useSaveCaption(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ photoId, caption, lang }: { photoId: string; caption: string; lang: Language }) => {
      const { error } = await supabase
        .from("media")
        .update({ caption: caption.trim() || null, lang })
        .eq("id", photoId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: photosKey(personId) });
      void queryClient.invalidateQueries({ queryKey: ["profile-photos"] });
    },
  });
}

/** Who may add photos of this person (the database checks again). */
export function canAddPhotos(person: {
  myRole: string | null;
  claimed_by_user_id: string | null;
  my_access?: { hiddenMinor?: boolean } | null;
}, userId: string | undefined): boolean {
  if (person.my_access?.hiddenMinor) return false;
  return person.myRole === "owner" || person.myRole === "editor" || (!!userId && person.claimed_by_user_id === userId);
}

/** Who may change or delete a photo (the database checks again). */
export function canManagePhoto(
  photo: Pick<Photo, "uploaded_by">,
  person: { myRole: string | null; claimed_by_user_id: string | null },
  userId: string | undefined,
): boolean {
  if (!userId) return false;
  return photo.uploaded_by === userId || person.claimed_by_user_id === userId || person.myRole === "owner";
}
