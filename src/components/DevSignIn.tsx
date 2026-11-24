import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { supabase } from "@/lib/supabase";

/**
 * Password sign-in for test accounts, so a second user can be tested without
 * a second email inbox. Only rendered when __DEV__ is true (Expo Go and
 * `npx expo start`); release builds and the web export leave it out.
 * Test users are created in the Supabase dashboard (Authentication → Users →
 * Add user, with "Auto confirm").
 */
export function DevSignIn() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!__DEV__) return null;

  const signIn = async () => {
    setBusy(true);
    setFailed(false);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    // On success the auth listener switches to the signed-in screens.
    if (error) setFailed(true);
  };

  return (
    <View className="gap-3 rounded-xl border border-dashed border-amber-500 p-4">
      <Text className="text-base font-semibold text-amber-700 dark:text-amber-400">{t("dev.title")}</Text>
      <Text className="text-sm text-gray-600 dark:text-gray-400">{t("dev.note")}</Text>
      <TextField
        label={t("dev.email")}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <TextField
        label={t("dev.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        error={failed ? t("dev.failed") : null}
        onSubmitEditing={() => void signIn()}
      />
      <Button
        variant="secondary"
        label={t("dev.signIn")}
        loading={busy}
        disabled={!email || !password}
        onPress={() => void signIn()}
      />
    </View>
  );
}
