import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/** Shows who is signed in, with a sign-out button. */
export function AccountCard() {
  const { t } = useTranslation("auth");
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    // "local" = only this device; other phones and computers stay signed in.
    await supabase.auth.signOut({ scope: "local" });
    // Forget cached data from this account so the next person can't see it.
    queryClient.clear();
    setSigningOut(false);
  };

  return (
    <View className="gap-3 rounded-xl bg-white p-4 dark:bg-gray-900">
      <Text className="text-base text-gray-900 dark:text-gray-100">
        {t("account.signedInAs", { email: session?.user.email ?? "" })}
      </Text>
      <Button
        variant="secondary"
        label={t("account.signOut")}
        onPress={signOut}
        loading={signingOut}
      />
    </View>
  );
}
