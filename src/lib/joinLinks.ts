import { formatCode, isCompleteCode } from "./inviteCodes";

/**
 * Links that open the "enter a code" screen with the code filled in, such as
 * https://myorbit.click/join?code=K7QM-3XPA-9HTD. No app dependencies, so
 * this is easy to test.
 */

/** The website's address, without a trailing slash. Set in the build. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || "https://myorbit.click").replace(/\/+$/, "");

/** The link to put in an invite or tree-link message. */
export const joinLink = (code: string, base: string = WEB_URL) =>
  `${base.replace(/\/+$/, "")}/join?code=${encodeURIComponent(code)}`;

/**
 * The code in a join link, or null if the address isn't one. Works for the
 * website (https://myorbit.click/join?code=…), the app's own links
 * (myorbit://join?code=…) and Expo Go (exp://…/--/join?code=…).
 */
export function joinCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const withoutHash = url.split("#")[0] ?? "";
  const q = withoutHash.indexOf("?");
  const address = q < 0 ? withoutHash : withoutHash.slice(0, q);
  if (!/(^|[/:])join\/?$/i.test(address)) return null;
  const code = new URLSearchParams(q < 0 ? "" : withoutHash.slice(q + 1)).get("code");
  if (!code) return null;
  const formatted = formatCode(code);
  return isCompleteCode(formatted) ? formatted : null;
}
