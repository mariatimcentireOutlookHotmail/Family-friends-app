/**
 * Social links on a profile. Stored as { platform: what the person typed },
 * e.g. { instagram: "@meitan", whatsapp: "+62 811 1234" }. Shown with the
 * other contact details and protected by the same privacy level.
 */

export const SOCIAL_PLATFORMS = [
  "whatsapp",
  "wechat",
  "line",
  "instagram",
  "facebook",
  "linkedin",
  "telegram",
  "x",
  "tiktok",
  "website",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

/**
 * Platform names are brand names: the same in every language, like the
 * language names in the switcher. "website" is the one translated label.
 */
export const PLATFORM_NAMES: Record<Exclude<SocialPlatform, "website">, string> = {
  whatsapp: "WhatsApp",
  wechat: "WeChat",
  line: "LINE",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  telegram: "Telegram",
  x: "X",
  tiktok: "TikTok",
};

/** What to type: a username, a phone number or an ID (a key in the translations). */
export const PLATFORM_INPUT: Record<SocialPlatform, "username" | "phone" | "id" | "url"> = {
  whatsapp: "phone",
  wechat: "id",
  line: "id",
  instagram: "username",
  facebook: "username",
  linkedin: "username",
  telegram: "username",
  x: "username",
  tiktok: "username",
  website: "url",
};

const HOSTS: Partial<Record<SocialPlatform, string[]>> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  linkedin: ["linkedin.com"],
  telegram: ["t.me", "telegram.me"],
  x: ["x.com", "twitter.com"],
  tiktok: ["tiktok.com"],
  line: ["line.me"],
  whatsapp: ["wa.me", "whatsapp.com"],
};

const isSafeHandle = (h: string) => /^[\p{L}\p{N}._-]{1,100}$/u.test(h);

/** A pasted https link on the platform's own site, or null. */
function platformUrl(platform: SocialPlatform, value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (platform === "website") return url.toString();
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const ok = HOSTS[platform]?.some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? `https://${url.host}${url.pathname}${url.search}` : null;
}

/**
 * The link to open for a social entry, or null when there is none (WeChat
 * IDs, or text that doesn't look like a username). Only ever https links.
 */
export function socialUrl(platform: SocialPlatform, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return platformUrl(platform, value);
  if (platform === "website") return platformUrl(platform, `https://${value}`);

  const handle = value.replace(/^@/, "");
  switch (platform) {
    case "whatsapp": {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 7 ? `https://wa.me/${digits}` : null;
    }
    case "wechat":
      return null; // WeChat has no public profile links: show the ID to copy.
    default:
      break;
  }
  if (!isSafeHandle(handle)) return null;
  switch (platform) {
    case "instagram":
      return `https://instagram.com/${handle}`;
    case "facebook":
      return `https://facebook.com/${handle}`;
    case "linkedin":
      return `https://www.linkedin.com/in/${handle}`;
    case "telegram":
      return `https://t.me/${handle}`;
    case "x":
      return `https://x.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "line":
      return `https://line.me/ti/p/~${handle}`;
  }
  return null;
}

/** Known platforms with a value, in display order. */
export function socialEntries(links: SocialLinks | null | undefined): [SocialPlatform, string][] {
  if (!links) return [];
  return SOCIAL_PLATFORMS.filter((p) => links[p]?.trim()).map((p) => [p, links[p]!.trim()]);
}
