import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enDates from "./locales/en/dates.json";
import enEdit from "./locales/en/edit.json";
import enPerson from "./locales/en/person.json";
import enPrivacy from "./locales/en/privacy.json";
import enSettings from "./locales/en/settings.json";
import enTree from "./locales/en/tree.json";
import idAuth from "./locales/id/auth.json";
import idCommon from "./locales/id/common.json";
import idDates from "./locales/id/dates.json";
import idEdit from "./locales/id/edit.json";
import idPerson from "./locales/id/person.json";
import idPrivacy from "./locales/id/privacy.json";
import idSettings from "./locales/id/settings.json";
import idTree from "./locales/id/tree.json";
import zhHansAuth from "./locales/zh-Hans/auth.json";
import zhHansCommon from "./locales/zh-Hans/common.json";
import zhHansDates from "./locales/zh-Hans/dates.json";
import zhHansEdit from "./locales/zh-Hans/edit.json";
import zhHansPerson from "./locales/zh-Hans/person.json";
import zhHansPrivacy from "./locales/zh-Hans/privacy.json";
import zhHansSettings from "./locales/zh-Hans/settings.json";
import zhHansTree from "./locales/zh-Hans/tree.json";

import type { Language } from "./languages";

/** Namespaces = one JSON file per feature area. */
export const NAMESPACES = ["common", "settings", "auth", "tree", "person", "edit", "dates", "privacy"] as const;
export const DEFAULT_NAMESPACE = "common";

/** English is the source of truth for keys (see ./i18next.d.ts). */
export const enResources = {
  common: enCommon,
  settings: enSettings,
  auth: enAuth,
  tree: enTree,
  person: enPerson,
  edit: enEdit,
  dates: enDates,
  privacy: enPrivacy,
} as const;

export const resources: Record<Language, typeof enResources> = {
  en: enResources,
  id: { common: idCommon, settings: idSettings, auth: idAuth, tree: idTree, person: idPerson, edit: idEdit, dates: idDates, privacy: idPrivacy },
  "zh-Hans": { common: zhHansCommon, settings: zhHansSettings, auth: zhHansAuth, tree: zhHansTree, person: zhHansPerson, edit: zhHansEdit, dates: zhHansDates, privacy: zhHansPrivacy },
};
