import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import idCommon from "./locales/id/common.json";
import idSettings from "./locales/id/settings.json";
import zhHansCommon from "./locales/zh-Hans/common.json";
import zhHansSettings from "./locales/zh-Hans/settings.json";

import type { Language } from "./languages";

/** Namespaces = one JSON file per feature area. */
export const NAMESPACES = ["common", "settings"] as const;
export const DEFAULT_NAMESPACE = "common";

/** English is the source of truth for keys (see ./i18next.d.ts). */
export const enResources = {
  common: enCommon,
  settings: enSettings,
} as const;

export const resources: Record<Language, typeof enResources> = {
  en: enResources,
  id: { common: idCommon, settings: idSettings },
  "zh-Hans": { common: zhHansCommon, settings: zhHansSettings },
};
