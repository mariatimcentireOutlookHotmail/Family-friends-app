#!/usr/bin/env node
// Fails (exit 1) if any language is missing a key that English has, has an
// extra key English doesn't, has an empty string, or has broken ICU syntax.
// Run: npm run i18n:check  (also meant for CI on every push)

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "src", "i18n", "locales");
const SOURCE = "en";

const languages = readdirSync(localesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const namespaces = readdirSync(join(localesDir, SOURCE)).filter((f) => f.endsWith(".json"));

/** Flatten {a: {b: "x"}} to {"a.b": "x"}. */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function load(lng, file) {
  const path = join(localesDir, lng, file);
  if (!existsSync(path)) return null;
  try {
    return flatten(JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    throw new Error(`${lng}/${file}: invalid JSON (${e.message})`);
  }
}

const errors = [];

for (const file of namespaces) {
  const source = load(SOURCE, file);
  for (const lng of languages) {
    const messages = load(lng, file);
    if (!messages) {
      errors.push(`${lng}/${file}: file is missing`);
      continue;
    }
    for (const key of Object.keys(source)) {
      if (!(key in messages)) errors.push(`${lng}/${file}: missing key "${key}"`);
    }
    for (const [key, value] of Object.entries(messages)) {
      if (!(key in source)) errors.push(`${lng}/${file}: extra key "${key}" (not in ${SOURCE})`);
      if (typeof value !== "string" || value.trim() === "") {
        errors.push(`${lng}/${file}: "${key}" is empty or not a string`);
        continue;
      }
      try {
        new IntlMessageFormat(value, lng);
      } catch (e) {
        errors.push(`${lng}/${file}: "${key}" has invalid ICU syntax (${e.message})`);
      }
    }
  }
}

if (errors.length) {
  console.error(`Translation check failed (${errors.length}):\n  ` + errors.join("\n  "));
  process.exit(1);
}
console.log(
  `Translations OK: ${languages.join(", ")} × ${namespaces.length} namespace(s).`,
);
