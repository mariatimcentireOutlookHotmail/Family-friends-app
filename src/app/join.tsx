import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ChoiceChips } from "@/components/ui/ChoiceChips";
import { TextField } from "@/components/ui/TextField";
import { formatCode, inviteErrorKey, isCompleteCode, useAcceptInvite, type InvitePreview } from "@/lib/invites";
import {
  isInvalidLinkCode,
  linkErrorKey,
  useAcceptLink,
  useCodePreview,
  type LinkPreview,
  type LinkedCard,
} from "@/lib/treeLinks";
import { takePendingJoin } from "@/lib/pendingJoin";
import { everydayName, lifeYears, primaryName, useMyTrees, type Tree } from "@/lib/trees";

/**
 * Enter a code: either an invite (claim your profile) or a request to link
 * two family trees (pick the same person in one of your trees).
 * Also opens from a link with ?code=… (https://myorbit.click/join?code=… or
 * myorbit://join?code=…), and then checks the code straight away.
 */
export default function JoinScreen() {
  const { t } = useTranslation("invite");
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(formatCode(params.code ?? ""));
  const preview = useCodePreview();

  const data = preview.data;
  const error = preview.isError ? inviteErrorKey(preview.error) : data?.kind === "invalid" ? "invalid" : null;

  const check = () => preview.mutate(code);

  // Opened from a link with a whole code: check it straight away. The code is
  // in use now, so drop any copy kept for after sign-in.
  const fromLink = isCompleteCode(formatCode(params.code ?? ""));
  const { mutate } = preview;
  useEffect(() => {
    takePendingJoin();
    if (fromLink) mutate(formatCode(params.code ?? ""));
    // Only when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView
      className="flex-1 bg-gray-50 dark:bg-black"
      contentContainerClassName="items-center p-6"
      keyboardShouldPersistTaps="handled"
    >
      <View className="w-full max-w-md gap-5">
        <Text className="text-base text-gray-700 dark:text-gray-300">{t("join.body")}</Text>

        <TextField
          label={t("join.codeLabel")}
          value={code}
          onChangeText={(text) => {
            setCode(formatCode(text));
            preview.reset();
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          inputClassName="text-center font-mono text-2xl tracking-widest"
          placeholder="XXXX-XXXX-XXXX"
          maxLength={14}
          onSubmitEditing={() => isCompleteCode(code) && check()}
        />

        {!data || data.kind === "invalid" ? (
          <Button
            label={preview.isPending ? t("join.checking") : t("join.check")}
            loading={preview.isPending}
            disabled={!isCompleteCode(code)}
            onPress={check}
          />
        ) : null}

        {error ? <Text className="text-base text-red-600 dark:text-red-400">{t(`errors.${error}`)}</Text> : null}

        {data?.kind === "invite" && data.status === "ok" ? (
          <InviteAccept code={code} invite={data as Extract<InvitePreview, { status: "ok" }>} />
        ) : null}
        {data?.kind === "link" ? <LinkAccept code={code} request={data} /> : null}
      </View>
    </ScrollView>
  );
}

function InviteAccept({ code, invite }: { code: string; invite: Extract<InvitePreview, { status: "ok" }> }) {
  const { t } = useTranslation("invite");
  const accept = useAcceptInvite();
  const [rejected, setRejected] = useState(false);

  if (rejected) {
    return <Text className="text-base text-gray-700 dark:text-gray-300">{t("join.notMeNote")}</Text>;
  }
  return (
    <View className="gap-4 rounded-xl bg-white p-4 dark:bg-gray-900">
      <Text className="text-base text-gray-700 dark:text-gray-300">
        {invite.inviterName
          ? t("join.previewWithInviter", { inviter: invite.inviterName, tree: invite.treeName })
          : t("join.preview", { tree: invite.treeName })}
      </Text>
      <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{invite.personName ?? "—"}</Text>
      {invite.alreadyInTree ? (
        <Text className="text-base text-red-600 dark:text-red-400">{t("errors.alreadyInTree")}</Text>
      ) : (
        <>
          <Text className="text-sm text-gray-600 dark:text-gray-400">{t("join.claimNote")}</Text>
          <Button
            label={accept.isPending ? t("join.joining") : t("join.thisIsMe")}
            loading={accept.isPending}
            onPress={() =>
              accept.mutate(code, {
                onSuccess: (personId) => router.replace({ pathname: "/person/[id]", params: { id: personId } }),
              })
            }
          />
          <Button variant="secondary" label={t("join.notMe")} onPress={() => setRejected(true)} />
        </>
      )}
      {accept.isError ? (
        <Text className="text-base text-red-600 dark:text-red-400">{t(`errors.${inviteErrorKey(accept.error)}`)}</Text>
      ) : null}
    </View>
  );
}

const cardName = (c: LinkedCard | null) =>
  c ? [c.nickname ? `${c.nickname} (${c.name ?? ""})` : c.name, c.birthYear].filter(Boolean).join(" · ") : "—";

function LinkAccept({ code, request }: { code: string; request: LinkPreview }) {
  const { t } = useTranslation("links");
  const trees = useMyTrees();
  const accept = useAcceptLink();
  const [treeId, setTreeId] = useState<string | null>(request.myTrees.length === 1 ? request.myTrees[0]!.id : null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const tree: Tree | undefined = trees.data?.find((x) => x.id === treeId);
  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tree?.persons ?? [])
      .filter((p) => primaryName(p)) // not hidden minors
      .filter((p) => !q || p.person_names.some((n) => n.full_display.toLowerCase().includes(q)))
      .sort((a, b) => (everydayName(a) ?? "").localeCompare(everydayName(b) ?? ""));
  }, [tree, search]);

  const errorKey = accept.isError ? linkErrorKey(accept.error) : null;

  return (
    <View className="gap-4 rounded-xl bg-white p-4 dark:bg-gray-900">
      <Text className="text-base text-gray-700 dark:text-gray-300">
        {request.requesterName
          ? t("join.preview", { requester: request.requesterName, tree: request.treeName })
          : t("join.previewNoRequester", { tree: request.treeName })}
      </Text>
      <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{cardName(request.person)}</Text>

      {request.myTrees.length === 0 ? (
        <Text className="text-base text-gray-700 dark:text-gray-300">{t("join.noOwnedTrees")}</Text>
      ) : (
        <>
          {request.myTrees.length > 1 ? (
            <ChoiceChips
              label={t("join.pickTree")}
              value={treeId ?? ""}
              onChange={(id) => {
                setTreeId(id);
                setPersonId(null);
              }}
              options={request.myTrees.map((x) => ({ value: x.id, label: x.name }))}
            />
          ) : null}
          {tree ? (
            <View className="gap-2">
              <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{t("join.pickPerson")}</Text>
              {tree.persons.length > 8 ? (
                <TextField label={t("join.search")} value={search} onChangeText={setSearch} autoCorrect={false} />
              ) : null}
              <View accessibilityRole="radiogroup" className="gap-1.5">
                {people.map((p) => {
                  const selected = p.id === personId;
                  const label = [everydayName(p), lifeYears(p)].filter(Boolean).join(" · ");
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => setPersonId(p.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={label}
                      className={`min-h-11 justify-center rounded-lg border px-3 ${
                        selected
                          ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                          : "border-gray-200 dark:border-gray-800"
                      }`}
                    >
                      <Text className="text-base text-gray-900 dark:text-gray-100">{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          <Button
            label={accept.isPending ? t("join.linking") : t("join.link")}
            loading={accept.isPending}
            disabled={!personId}
            onPress={() =>
              accept.mutate(
                { code, personId: personId! },
                { onSuccess: (id) => router.replace({ pathname: "/person/[id]", params: { id } }) },
              )
            }
          />
          {accept.isError ? (
            <Text className="text-base text-red-600 dark:text-red-400">
              {errorKey
                ? t(`errors.${errorKey}`)
                : t(`errors.${isInvalidLinkCode(accept.error) ? "invalid" : inviteErrorKey(accept.error)}`, { ns: "invite" })}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
