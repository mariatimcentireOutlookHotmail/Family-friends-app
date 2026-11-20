import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "./Button";

type Props = {
  title: string;
  explain: string;
  buttonLabel: string;
  confirmText: string;
  confirmLabel: string;
  cancelLabel: string;
  busyLabel: string;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
};

/**
 * A destructive action with a built-in "Are you sure?" step. Works the same on
 * phones and the web (unlike system alert dialogs, which behave differently).
 */
export function ConfirmAction(props: Props) {
  const [asking, setAsking] = useState(false);

  return (
    <View className="gap-3 rounded-xl border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-gray-900">
      <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{props.title}</Text>
      <Text className="text-sm text-gray-600 dark:text-gray-400">{props.explain}</Text>

      {asking ? (
        <>
          <Text className="text-base font-semibold text-red-700 dark:text-red-400">{props.confirmText}</Text>
          <Button
            variant="danger"
            label={props.busy ? props.busyLabel : props.confirmLabel}
            loading={props.busy}
            onPress={props.onConfirm}
          />
          <Button variant="secondary" label={props.cancelLabel} onPress={() => setAsking(false)} />
        </>
      ) : (
        <Button variant="secondary" label={props.buttonLabel} onPress={() => setAsking(true)} />
      )}

      {props.error ? (
        <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
          {props.error}
        </Text>
      ) : null}
    </View>
  );
}
