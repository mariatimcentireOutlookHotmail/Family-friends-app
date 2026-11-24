import { Platform } from "react-native";

import { joinCodeFromUrl } from "./joinLinks";

/**
 * Someone who opens an invite link while signed out is sent to sign in first,
 * which loses the address. The code is kept here until they're signed in;
 * the home screen then opens the join screen with it.
 * Kept in memory, and on the web also for this browser tab (sessionStorage),
 * so it survives a page reload during sign-in.
 */

const KEY = "myorbit.pendingJoin";
let pending: string | null = null;

function storage(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberJoinFromUrl(url: string | null | undefined) {
  const code = joinCodeFromUrl(url);
  if (!code) return;
  pending = code;
  try {
    storage()?.setItem(KEY, code);
  } catch {
    // Private browsing can refuse storage; memory is enough then.
  }
}

/** The saved code, if any, without clearing it. */
export function peekPendingJoin(): string | null {
  if (pending) return pending;
  try {
    return storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

/** The saved code, if any; clears it. */
export function takePendingJoin(): string | null {
  const code = peekPendingJoin();
  pending = null;
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
  return code;
}

// In the browser, read the address the page was opened with before the app
// has a chance to redirect to the sign-in screen.
if (Platform.OS === "web" && typeof window !== "undefined") {
  rememberJoinFromUrl(window.location.href);
}
