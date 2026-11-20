import "i18next";

import type { DEFAULT_NAMESPACE, enResources } from "./resources";

// Makes t("...") keys type-checked against the English files, so a typo or a
// missing English key fails `npm run typecheck`.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE;
    resources: typeof enResources;
  }
}
