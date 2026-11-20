# Family & Friends app

A free, non-commercial family and friends app (a family tree that grows through
invitations), built solo as a practice project. One TypeScript codebase for iOS,
Android and web. Full plan: `projectPlan.doc`. Ask before changing anything the
plan marks as a decision.

## How to work with me (the developer)

- One feature per session, small and clear. Use plan mode first for anything
  bigger than one file.
- Explain changes in plain language; I review every diff and want to learn from it.
- Make small steps that I can commit one at a time.
- Write tests together with each feature, and run the checks before saying a task is done.
- Leave the hard decisions to me: privacy defaults, kinship words (checked with a
  native speaker), and what goes into each phase. Park new ideas for Phase 5
  instead of growing scope.

## Stack

| Layer | Choice |
|---|---|
| App | React Native + Expo (SDK 58), Expo Router, TypeScript (strict) |
| Styling | NativeWind v4 (Tailwind CSS 3) via `className` |
| Data fetching | TanStack Query + Supabase JS client (`src/lib/supabase.ts`) |
| Tree rendering | react-native-svg, d3-hierarchy for layout math only (not added yet) |
| Gestures | react-native-gesture-handler + Reanimated |
| Backend | Supabase: Postgres, Auth, Row-Level Security, Storage, Edge Functions |
| i18n | i18next + react-i18next + i18next-icu, expo-localization, Intl APIs |
| Tests | Vitest (logic), SQL tests (RLS) |
| Hosting | Expo web export on Vercel or Netlify; GitHub Actions for CI |

Everything must stay on free tiers. Don't add paid services, Twilio, Sentry, Skia
or E2E tools without asking. Never use React Flow or D3 DOM rendering for the tree:
they don't run on native.

Expo changes between SDKs. Before using an Expo or React Native API, check the
docs for the version in `package.json` (https://docs.expo.dev/versions/v58.0.0/)
instead of relying on memory.

## Folder layout

```
src/
  app/            Expo Router routes only (every file is a screen; _layout.tsx = navigator)
  components/     Shared UI components
  lib/            Non-UI code: Supabase client, data hooks
  i18n/
    index.ts      i18next setup, device language, setLanguage()
    languages.ts  Supported languages and their autonyms
    resources.ts  Registers the JSON files
    locales/<lang>/<namespace>.json   one file per feature area
  global.css      Tailwind directives
scripts/          Dev scripts (translation check)
.github/workflows CI: runs typecheck, lint, translation check and a web build on every push
```

Keep non-route code out of `src/app/`. Import with the `@/` alias (`@/i18n`, `@/components/...`).

## Commands

```bash
npm start                 # dev server (scan the QR code with Expo Go)
npm run web               # run in the browser
npm run check             # typecheck + lint + translation check: run before every commit
npm run lint              # lint only (includes the no-hard-coded-text rule)
npx expo install <pkg>    # ALWAYS use this to add packages (picks SDK-compatible versions)
npx expo start -c         # clear Metro cache (after changing tailwind or babel config)
```

## Rules

### Languages: English (`en`), Indonesian (`id`), Simplified Chinese (`zh-Hans`)

- **No hard-coded UI text.** Every user-visible string goes through `t()` and lives
  in `src/i18n/locales/<lang>/<namespace>.json`. Only exception: language autonyms
  in `languages.ts`. The lint rule `i18next/no-literal-string` enforces this; don't
  disable it to make a check pass.
- **Add every new key to all three languages in the same change.** Draft id and
  zh-Hans yourself, and tell me which strings need native-speaker review.
- English is the source of truth for keys; `t()` keys are type-checked against it.
- New feature area → new namespace file in all three folders, registered in `resources.ts`.
- Plurals use ICU syntax: `{count, plural, one {# relative} other {# relatives}}`.
  Indonesian and Chinese need only the `other` case.
- Format dates, numbers and lists with `Intl` using the current language. Never
  concatenate translated fragments; use placeholders like `{name}`.
- Use start/end (e.g. `ps-4`, `ms-2`, `text-start`), not left/right, in styles.
- User-written content (stories, bios, comments) stays in the language it was
  written in and is stored with its language tag. No machine translation in v1.

### Names, kinship and dates

- Names are stored as parts in `person_names` (given, family, patronymic, prefix,
  suffix, full display, script, type, lang). Never assume "first + last". A person
  can have several names. Display order follows the name's own culture.
- **Never store relationship labels** ("uncle"). Compute the relationship path,
  then turn it into a word with a per-language kinship function. Chinese and
  Indonesian depend on side (paternal/maternal) and/or elder vs younger; fall
  back to a descriptive phrase when birth order is unknown.
- Genealogy dates are partial: separate year/month/day columns plus a qualifier
  (about, before, after), matching GEDCOM. Gregorian calendar only in v1.

### Data model and privacy

- The data is a graph, not a tree: store typed relationships (parent, partner,
  sibling, friend) with subtype (biological, adoptive, step, married, divorced),
  start/end dates and certainty. Render a tree-shaped view centred on one person.
- People (`persons`) are separate from login accounts; a person can exist as a
  shadow profile until claimed.
- **Every table needs Row-Level Security**, with SQL tests proving each visibility
  level hides what it should. A privacy leak is the worst possible bug.
- Living people are private by default: contact details and addresses Private;
  birth dates Immediate family; names and photos Extended tree.
- Once a profile is claimed, only its owner edits core fields; others suggest changes.
- Minors (age threshold per country's law): visible to immediate family only,
  cannot be invited directly.
- Invite tokens: single-use, stored hashed, expire after 14 days, revocable.
- Support account deletion (anonymized placeholder if others depend on the node)
  and data export (JSON and GEDCOM).

### Secrets

- Always import the client from `@/lib/supabase`; never create another one.
- Never commit secrets. `.env` and `.env.*` are git-ignored; only `.env.example`
  (placeholder values) is committed.
- Anything prefixed `EXPO_PUBLIC_` is bundled into the app and visible to anyone.
  Only the Supabase URL and the public key (publishable/anon) may go there. The **service_role** key
  and other server secrets live only in Supabase Edge Function secrets.

### Quality

- Unit-test relationship logic and every kinship function (e.g. father's elder
  brother → uncle / pakde / 伯父).
- Run `npm run check` before every commit; CI must fail on missing translation
  keys or broken ICU syntax.
- After each phase, check the core flow on a phone (Expo Go) and in a browser in
  all three languages.
