import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { authErrorKey, isValidEmail } from "@/lib/authErrors";
import { supabase } from "@/lib/supabase";

export default function SignInScreen() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const sendCode = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!isValidEmail(trimmed)) {
      setError(t("errors.invalidEmail"));
      return;
    }
    setError(null);
    setSending(true);
    // Creates the account on first sign-in, then emails a one-time code.
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: true },
    });
    setSending(false);
    if (sendError) {
      setError(t(`errors.${authErrorKey(sendError)}`));
      return;
    }
    router.push({ pathname: "/verify", params: { email: trimmed } });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-gray-50 dark:bg-black"
    >
      <ScrollView contentContainerClassName="items-center p-6" keyboardShouldPersistTaps="handled">
        <View className="w-full max-w-md gap-6">
          <View className="gap-2">
            <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {t("signIn.heading")}
            </Text>
            <Text className="text-base text-gray-700 dark:text-gray-300">{t("signIn.subtitle")}</Text>
          </View>

          <TextField
            label={t("signIn.emailLabel")}
            placeholder={t("signIn.emailPlaceholder")}
            value={email}
            onChangeText={setEmail}
            error={error}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            inputMode="email"
            returnKeyType="send"
            onSubmitEditing={sendCode}
            editable={!sending}
          />

          <Button
            label={sending ? t("signIn.sending") : t("signIn.send")}
            onPress={sendCode}
            loading={sending}
          />

          <View className="mt-4">
            <LanguageSwitcher />
          </View>

          <Button
            variant="link"
            label={t("note.link", { ns: "privacy" })}
            onPress={() => router.push("/about-privacy")}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
