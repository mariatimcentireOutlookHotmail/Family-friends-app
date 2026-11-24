import enAuth from "./locales/en/auth.json";
import enBirthdays from "./locales/en/birthdays.json";
import enCommon from "./locales/en/common.json";
import enDates from "./locales/en/dates.json";
import enEdit from "./locales/en/edit.json";
import enHistory from "./locales/en/history.json";
import enInvite from "./locales/en/invite.json";
import enLinks from "./locales/en/links.json";
import enPhotos from "./locales/en/photos.json";
import enStories from "./locales/en/stories.json";
import enPerson from "./locales/en/person.json";
import enPrivacy from "./locales/en/privacy.json";
import enSettings from "./locales/en/settings.json";
import enTree from "./locales/en/tree.json";
import enTreeView from "./locales/en/treeView.json";
import idAuth from "./locales/id/auth.json";
import idBirthdays from "./locales/id/birthdays.json";
import idCommon from "./locales/id/common.json";
import idDates from "./locales/id/dates.json";
import idEdit from "./locales/id/edit.json";
import idHistory from "./locales/id/history.json";
import idInvite from "./locales/id/invite.json";
import idLinks from "./locales/id/links.json";
import idPhotos from "./locales/id/photos.json";
import idStories from "./locales/id/stories.json";
import idPerson from "./locales/id/person.json";
import idPrivacy from "./locales/id/privacy.json";
import idSettings from "./locales/id/settings.json";
import idTree from "./locales/id/tree.json";
import idTreeView from "./locales/id/treeView.json";
import zhHansAuth from "./locales/zh-Hans/auth.json";
import zhHansBirthdays from "./locales/zh-Hans/birthdays.json";
import zhHansCommon from "./locales/zh-Hans/common.json";
import zhHansDates from "./locales/zh-Hans/dates.json";
import zhHansEdit from "./locales/zh-Hans/edit.json";
import zhHansHistory from "./locales/zh-Hans/history.json";
import zhHansInvite from "./locales/zh-Hans/invite.json";
import zhHansLinks from "./locales/zh-Hans/links.json";
import zhHansPhotos from "./locales/zh-Hans/photos.json";
import zhHansStories from "./locales/zh-Hans/stories.json";
import zhHansPerson from "./locales/zh-Hans/person.json";
import zhHansPrivacy from "./locales/zh-Hans/privacy.json";
import zhHansSettings from "./locales/zh-Hans/settings.json";
import zhHansTree from "./locales/zh-Hans/tree.json";
import zhHansTreeView from "./locales/zh-Hans/treeView.json";

import type { Language } from "./languages";

/** Namespaces = one JSON file per feature area. */
export const NAMESPACES = ["common", "settings", "auth", "tree", "person", "edit", "dates", "privacy", "treeView", "invite", "history", "links", "photos", "stories", "birthdays"] as const;
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
  treeView: enTreeView,
  invite: enInvite,
  history: enHistory,
  links: enLinks,
  photos: enPhotos,
  stories: enStories,
  birthdays: enBirthdays,
} as const;

export const resources: Record<Language, typeof enResources> = {
  en: enResources,
  id: { common: idCommon, settings: idSettings, auth: idAuth, tree: idTree, person: idPerson, edit: idEdit, dates: idDates, privacy: idPrivacy, treeView: idTreeView, invite: idInvite, history: idHistory, links: idLinks, photos: idPhotos, stories: idStories, birthdays: idBirthdays },
  "zh-Hans": { common: zhHansCommon, settings: zhHansSettings, auth: zhHansAuth, tree: zhHansTree, person: zhHansPerson, edit: zhHansEdit, dates: zhHansDates, privacy: zhHansPrivacy, treeView: zhHansTreeView, invite: zhHansInvite, history: zhHansHistory, links: zhHansLinks, photos: zhHansPhotos, stories: zhHansStories, birthdays: zhHansBirthdays },
};
