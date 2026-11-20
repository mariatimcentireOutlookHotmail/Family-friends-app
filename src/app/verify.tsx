import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { authErrorKey } from "@/lib/authErrors";
import { supabase } from "@/lib/supabase";

/** Supabase lets the same address request a new code once a minute. */
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyScreen() {
  const { t } = useTranslation("auth");
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!email) return <Redirect href="/sign-in" />;

  const verify = async () => {
    const token = code.replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(token)) {
      setError(t("errors.codeFormat"));
      return;
    }
    setError(null);
    setNotice(null);
    setVerifying(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setVerifying(false);
    // On success the session changes and the app moves to the home screen.
    if (verifyError) setError(t(`errors.${authErrorKey(verifyError)}`));
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    setResending(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({ email });
    setResending(false);
    if (sendError) {
      setError(t(`errors.${authErrorKey(sendError)}`));
      return;
    }
    setNotice(t("verify.resent"));
    setCooldown(RESEND_COOLDOWN_SECONDS);
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
              {t("verify.heading")}
            </Text>
            <Text className="text-base text-gray-700 dark:text-gray-300">
              {t("verify.sentTo", { email })}
            </Text>
          </View>

          <TextField
            label={t("verify.codeLabel")}
            value={code}
            onChangeText={(text) => setCode(text.replace(/[^\d]/g, ""))}
            error={error}
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={10}
            returnKeyType="done"
            onSubmitEditing={verify}
            editable={!verifying}
            inputClassName="text-center text-2xl tracking-[8px]"
          />

          {notice ? (
            <Text accessibilityRole="alert" className="text-sm text-green-700 dark:text-green-400">
              {notice}
            </Text>
          ) : null}

          <Button
            label={verifying ? t("verify.verifying") : t("verify.verify")}
            onPress={verify}
            loading={verifying}
          />

          <View className="gap-1">
            <Button
              variant="link"
              label={cooldown > 0 ? t("verify.resendIn", { seconds: cooldown }) : t("verify.resend")}
              onPress={resend}
              disabled={cooldown > 0}
              loading={resending}
            />
            <Button variant="link" label={t("verify.changeEmail")} onPress={() => router.replace("/sign-in")} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
