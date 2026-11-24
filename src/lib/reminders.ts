import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { Platform } from "react-native";

/**
 * Birthday reminders on this phone: a notification at 9:00 on the day.
 * These are local notifications, scheduled by the app itself — no server or
 * push service. They're re-planned each time the birthdays list loads, so
 * newly added or changed birthdays are picked up when the app is opened.
 * Not available on the web.
 */

const SETTING_KEY = "birthday-reminders";
const CHANNEL = "birthdays";
const HOUR = 9;
/** iOS allows 64 pending local notifications; stay well under. */
const MAX_SCHEDULED = 40;

export const remindersSupported = Platform.OS !== "web";

if (remindersSupported) {
  // Show reminders even when the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function remindersEnabled(): Promise<boolean> {
  if (!remindersSupported) return false;
  try {
    return (await AsyncStorage.getItem(SETTING_KEY)) === "on";
  } catch {
    return false;
  }
}

/** Turns reminders on (asking the phone's permission first) or off. */
export async function setRemindersEnabled(on: boolean, channelName: string): Promise<"on" | "off" | "denied"> {
  if (!remindersSupported) return "off";
  if (on) {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return "denied";
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: channelName,
        importance: AndroidImportance.DEFAULT,
      });
    }
  } else {
    await cancelBirthdayReminders();
  }
  await AsyncStorage.setItem(SETTING_KEY, on ? "on" : "off");
  return on ? "on" : "off";
}

export type ReminderItem = { personId: string; date: Date; title: string; body: string };

async function cancelBirthdayReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { kind?: string } | null)?.kind === "birthday")
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** Replaces this phone's birthday reminders with the given ones. */
export async function scheduleBirthdayReminders(items: ReminderItem[]): Promise<number> {
  if (!remindersSupported || !(await remindersEnabled())) return 0;
  await cancelBirthdayReminders();
  const now = Date.now();
  const due = items
    .map((item) => {
      const at = new Date(item.date);
      at.setHours(HOUR, 0, 0, 0);
      return { ...item, at };
    })
    .filter((item) => item.at.getTime() > now)
    .slice(0, MAX_SCHEDULED);
  for (const item of due) {
    await Notifications.scheduleNotificationAsync({
      content: { title: item.title, body: item.body, data: { kind: "birthday", personId: item.personId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.at, channelId: CHANNEL },
    });
  }
  return due.length;
}

/** Calls `open(personId)` when someone taps a birthday reminder. Returns a cleanup. */
export function onReminderTapped(open: (personId: string) => void): () => void {
  if (!remindersSupported) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { kind?: string; personId?: string } | null;
    if (data?.kind === "birthday" && data.personId) open(data.personId);
  });
  return () => sub.remove();
}
