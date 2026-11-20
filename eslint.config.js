// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const i18next = require("eslint-plugin-i18next");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", ".expo/*", "node_modules/*"],
  },
  {
    // i18next's default export and its named exports are the same instance,
    // so this warning is just noise here.
    rules: { "import/no-named-as-default-member": "off" },
  },
  {
    // No hard-coded UI text: words written directly between JSX tags, e.g.
    // <Text>Hello</Text>, must come from t("...") instead. See CLAUDE.md.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": {
            // Also catch text in props people read or hear.
            include: ["title", "placeholder", "accessibilityLabel", "accessibilityHint", "alt"],
          },
        },
      ],
    },
  },
]);
