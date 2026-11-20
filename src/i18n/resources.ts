import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import idAuth from "./locales/id/auth.json";
import idCommon from "./locales/id/common.json";
import idSettings from "./locales/id/settings.json";
import zhHansAuth from "./locales/zh-Hans/auth.json";
import zhHansCommon from "./locales/zh-Hans/common.json";
import zhHansSettings from "./locales/zh-Hans/settings.json";

import type { Language } from "./languages";

/** Namespaces = one JSON file per feature area. */
export const NAMESPACES = ["common", "settings", "auth"] as const;
export const DEFAULT_NAMESPACE = "common";

/** English is the source of truth for keys (see ./i18next.d.ts). */
export const enResources = {
  common: enCommon,
  settings: enSettings,
  auth: enAuth,
} as const;

export const resources: Record<Language, typeof enResources> = {
  en: enResources,
  id: { common: idCommon, settings: idSettings, auth: idAuth },
  "zh-Hans": { common: zhHansCommon, settings: zhHansSettings, auth: zhHansAuth },
};
