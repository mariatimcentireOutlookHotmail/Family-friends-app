# MyOrbit (family & friends app)

A free, non-commercial family and friends app (a family tree that grows through
invitations), built solo as a practice project. One TypeScript codebase for iOS,
Android and web. Full plan: `projectPlan.doc`. Ask before changing anything the
plan marks as a decision.

The app is called **MyOrbit** in every language (never translate the name). The
logo is a sun with family "planets" on two crossing orbits; the source drawing is
`assets/logo/myorbit.svg`. If the logo changes, regenerate every PNG in
`assets/` from it (icon, Android layers, splash, favicon).

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
| Tree rendering | react-native-svg, d3-hierarchy for layout math only |
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
  components/     Shared UI components (ui/ = basic building blocks: Button, TextField)
  lib/            Non-UI code: Supabase client, auth session (useAuth), profile, data hooks
supabase/
  config.toml     Supabase CLI settings
  migrations/     Database changes as numbered SQL files (the source of truth for the schema)
tests/
  db/             RLS tests: PGlite (in-memory Postgres) + a stand-in for Supabase's auth
  i18n/
    index.ts      i18next setup, device language, setLanguage()
    languages.ts  Supported languages and their autonyms
    resources.ts  Registers the JSON files
    locales/<lang>/<namespace>.json   one file per feature area
  global.css      Tailwind directives
scripts/          Dev scripts (translation check)
.github/workflows CI: runs `npm run ci` on every push
```

Keep non-route code out of `src/app/`. Import with the `@/` alias (`@/i18n`, `@/components/...`).

## Commands

```bash
npm start                 # dev server (scan the QR code with Expo Go)
npm run web               # run in the browser
npm run check             # typecheck + lint + translation check: run before every commit
npm run lint              # lint only (includes the no-hard-coded-text rule)
npm test                  # Vitest: privacy-rule (RLS) tests in tests/db, plus logic tests
npm run ci                # everything CI runs: check + test + web build
npx supabase migration new <name>   # create a new, empty migration file
npm run db:push           # apply new migrations to the linked Supabase project
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
  Use `src/lib/names.ts` (detectScript, formatFullName) to build `full_display`;
  don't format names by hand in screens.
- Extra names default to type `aka` ("also known as"), e.g. a Chinese person's
  English name. Show them with `akaNames()` from `src/lib/trees.ts`.
- Relationships: `parent` is directed (person_a is the parent of person_b);
  `partner`, `sibling` and `friend` are stored once with person_a < person_b.
  "Child" is never stored; read it from the parent link. Group a person's links
  with `groupRelatives()` in `src/lib/relatives.ts`. The database refuses
  loops (being your own ancestor) and more than two biological parents.
- Adding a person related to someone goes through `add_relative` (runs with
  the caller's rights, so normal privacy rules apply).
- Editing a person's names/sex/living status goes through `save_person`
  (replaces the whole name list at once). Who may edit, delete or change links
  is decided by `permissionsFor()` in `src/lib/people.ts`, mirroring the
  database rules; the database still has the final say.
- Creating a tree with yourself in it goes through the database function
  `create_tree_with_me` (the only way a person can start out claimed).
- **Never store relationship labels** ("uncle"). Compute the relationship path,
  then turn it into a word with a per-language kinship function. Chinese and
  Indonesian depend on side (paternal/maternal) and/or elder vs younger; fall
  back to a descriptive phrase when birth order is unknown.
- Genealogy dates are partial: separate year/month/day columns plus a qualifier
  (about, before, after), matching GEDCOM. Gregorian calendar only in v1.
- Birth/death dates: `events` holds type, year and qualifier (visible to the
  whole tree); `event_dates` holds month and day, visible only to the person,
  their immediate family (parents, children, partners, siblings incl. via a
  shared parent) and, once deceased, the whole tree. Dates are written only via
  `private.set_life_date` (called by create_tree_with_me, add_relative and
  save_person); sending just a year keeps a day/month the editor can't see.
  Use `src/lib/dates.ts` to check, format (Intl) and compute ages.

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
- Per-field privacy (`field_visibility`): fields birth_date, death_date,
  contact; levels private / immediate / tree. Check visibility only with
  `private.can_see_field()`; change levels only via `set_privacy` (the
  claimant, or tree owners for an unclaimed profile). Years stay visible to
  the tree (needed for kinship), except for protected minors.
- Minors: age limit per person's `country` (`private.minor_age_limits`;
  18 if unknown). Others see a placeholder ("Private family member"): no
  names, dates or contacts; only self, immediate family and whoever added
  them see the child. The app reads `my_access` (a computed field on persons)
  to know what to show; never decide visibility in the app alone.
- The privacy note screen (`about-privacy`) is public on purpose; update its
  text whenever what we store or who sees it changes.
- Once a profile is claimed, only its owner edits core fields; others suggest changes.
- Minors (age threshold per country's law): visible to immediate family only,
  cannot be invited directly.
- Invite tokens: single-use, stored hashed, expire after 14 days, revocable.
- Support account deletion (anonymized placeholder if others depend on the node)
  and data export (JSON and GEDCOM).

### Sign-in and screens

- Sign-in is email + 6-digit code (Supabase OTP); no passwords for now.
- Which screens signed-in vs signed-out people can open is decided only in
  `src/app/_layout.tsx` with `Stack.Protected`. New app screens go inside the
  signed-in group.
- Get the session with `useAuth()` from `@/lib/auth`; don't call
  `supabase.auth.getSession()` in screens.
- Show Supabase errors through translated messages (see `src/lib/authErrors.ts`),
  never raw error text.
- The user's language is stored on their profile (`profiles.locale`) and synced
  on sign-in; null means "follow the device".

- After deleting something, navigate away *before* refreshing data (don't
  await the refresh in the mutation's onSuccess): otherwise the screen re-renders
  as "not found", unmounts, and TanStack Query drops the navigation callback.
- Destructive actions use `ConfirmAction` (an in-page "Are you sure?"), not
  system alert dialogs, which don't work the same on the web.

- Everyday name: lists, tree cards, relatives and history show a person's
  nickname, or else their first "also known as" name (`knownAs()`,
  `everydayName()`), with the full name beside it.
  Their own page and forms use the main name.

### Adding and connecting relatives

- "Add a relative" has two modes: someone new (`add_relative`) or someone
  already in the tree (`link_people`, all-or-nothing, several people at once).
- Suggestions keep the tree connected: a new full sibling becomes a child of
  the same parent(s); a new parent can also become the parent of the
  person's siblings. Siblings through a shared parent are shown on a
  person's page ("Through a shared parent") without needing a sibling link.
- Whole-tree helpers (`parentIds`, `childIds`, `impliedSiblingIds`, ...) live
  in `src/lib/relatives.ts` and are tested there.

### Kinship words

- Code: `src/lib/kinship/` — `path.ts` finds the shortest path from the
  viewer's own profile (blood links preferred over marriage), turning
  "parent then child" into a sibling step; `en.ts`, `id.ts`, `zhHans.ts` turn a
  path into a word plus a plain description. Shown via `useKinship()`.
- Never store labels; never guess. If elder/younger or the family side is
  unknown, return null for the term and show the description.
- Indonesian: standard terms (Paman/Bibi; no elder/younger split for uncles
  and aunts). Regional Javanese terms (Pakde/Bude) may come later.
- Chinese: formal terms (父亲, 母亲, 祖父, 外祖母, 伯父, 叔父, 舅父, 姑母, 姨母, …).
- Elder/younger comes from birth years, then birth order.
- Every new term needs a test in `src/lib/kinship/kinship.test.ts`, and a
  native-speaker check before release.

### Tree view

- Layout: `src/lib/treeLayout.ts` is pure TypeScript (no React). It returns card
  positions and line points for one focus person: parents and grandparents up
  (father left), partners right, siblings left, children down, friends right
  (optional layer). Modes: family, ancestors, descendants; 1–5 generations.
  Every layout change needs a test in `treeLayout.test.ts`, including "no two
  cards overlap".
- A child's other parent counts as a partner for layout, even without a
  partner link.
- Drawing: `src/components/TreeCanvas.tsx` — SVG lines under absolutely
  positioned cards, moved and zoomed with gesture-handler v3 hooks
  (`usePanGesture`, `usePinchGesture`) and Reanimated shared values. Keep
  gesture code in worklets so it runs on the UI thread. Zoom buttons must stay,
  because the web has no pinch.
- Tap a card opens the person; long-press re-centres. The home list and card
  views stay as the fallback for screen readers and very large trees.
- `GestureHandlerRootView` wraps the whole app in `src/app/_layout.tsx`.

### Invites and claiming

- Database: `supabase/migrations/20261120080000_invites.sql`; app: `src/lib/invites.ts`,
  `src/components/InviteSection.tsx`, `src/app/person/[id]/invite.tsx`, `src/app/join.tsx`.
- Codes are 12 characters (`XXXX-XXXX-XXXX`, no look-alike letters), stored only
  as a SHA-256 hash, single-use, 14 days, cancellable; one open invite per person.
  The plain code is shown once, right after it's made.
- Owners and editors invite. Claimed, deceased and under-age people can't be
  invited. Accepting makes the person an editor (owners/editors keep their role).
- All checks live in the database functions (`create_invite`, `invite_preview`,
  `accept_invite`, `revoke_invite`). Errors carry a machine key in `hint`
  (e.g. `invite_expired`), mapped to text by `inviteErrorKey()`.
- Wrong codes are rate-limited (10 per hour per user). A wrong code returns
  null/"invalid" instead of raising, so the failed attempt is kept.
- The shared message is written in the language the inviter picks
  (`i18n.getFixedT(lang, "invite")`). It includes a link
  (`https://myorbit.click/join?code=…`, `joinLink()` in `src/lib/joinLinks.ts`)
  and the code for typing in the app. A link opened while signed out keeps its
  code through sign-in (`src/lib/pendingJoin.ts`); the home screen then opens
  the join screen, which checks the code straight away.

### Contacts, social links, theme, test accounts

- Social links (`src/lib/social.ts`, `SocialLinks.tsx`) live in
  `person_contacts.social` as `{platform: text}` and follow the "contact"
  privacy level. Only known platforms; `socialUrl()` only ever builds https
  links (WeChat has none: the ID is shown to copy). Platform names are brand
  names and aren't translated.
- Colour themes (`src/lib/palettes.ts`: Indigo, Sky, Sage, Earth): the
  Tailwind `gray-*`, `indigo-*` (= accent), `white` and `black` classes read CSS
  variables (tailwind.config.js), set at the root with NativeWind `vars()`.
  Keep using only those colour names (plus red/green/amber for status) so
  every theme works; for SVG or props that need a colour value, use
  `usePaletteColors()`, never a hex code.
- Appearance (Automatic / Light / Dark) is saved per device (`src/lib/theme.ts`).
  `darkMode: "class"`, so "Automatic" is resolved from `Appearance` in code.
  Every screen needs `dark:` colours; headers follow via `ThemeProvider`.
- `DevSignIn` (password sign-in) shows only when `__DEV__` is true, for testing
  a second account. Test users are made in the Supabase dashboard. Never show
  it in release builds.

### History and undo

- `supabase/migrations/20261120100000_change_log.sql`: triggers log every change
  to persons, person_names, events, event_dates, person_contacts and
  relationships into `change_log` (before/after JSON, actor, time). One
  transaction = one group (`txid`) = one entry in the app, undone together.
- Deleting a person or a life date snapshots what goes with it; cascaded rows
  aren't logged separately. Whole-tree deletes skip logging.
- Read only through `tree_history()` (filters hidden minors, contacts and
  day/month by the viewer's rights). Undo only through `undo_change()`:
  owners only, refuses if the rows changed since (`history_conflict`) or the
  profile is claimed by someone else (`history_claimed`). Undos are logged too.
- New tables that hold family data need a `log_change` trigger and a branch in
  `private.record_change` / `historySummary.ts`, plus tests in
  `tests/db/changeLog.test.ts`.
- `src/lib/historySummary.ts` turns groups into readable lines (pure, tested);
  `src/app/history/[treeId].tsx` shows them (`?person=` for one person).
- DB tests run in one transaction, so `step()` sets `myorbit.change_group` to
  separate groups. The app never sets it.

### Linked trees

- `supabase/migrations/20261120110000_tree_links.sql`: an owner of tree A makes
  a link code for a person (`create_link_code`, same code rules as invites); an
  owner of tree B enters it on the join screen (`code_preview` tells invites and
  link codes apart) and picks the same person (`accept_link`). Either tree's
  owner can `unlink_trees`. Minors can't be linked.
- Members of either tree see the other family's version of the person and
  their close family via `person_links` — names, nickname, sex and years only;
  never contacts, full dates or minors. Link tables aren't readable directly.
- Linking/unlinking is written to both trees' History and can't be undone
  there (`history_not_undoable`), because it needs both families.
- App: `src/lib/treeLinks.ts`, `src/components/LinkedTrees.tsx`,
  `src/app/person/[id]/link-tree.tsx`, `src/app/join.tsx`.

### Photos

- `supabase/migrations/20261121000000_photos.sql`: private Storage bucket
  `media`, files at `<tree>/<person>/<photo id>.jpg` and `..._thumb.jpg`, one
  `public.media` row per photo (caption, profile flag, uploader). Rules on
  both the table and `storage.objects`; tests use a storage stub in
  `tests/db/supabase-stub.sql`.
- Visible to everyone who can see the person (never hidden minors). Added by
  owners, editors and the person themself; changed/deleted by the uploader,
  the person and owners. Exactly one profile photo per person with photos,
  kept by the database (first photo becomes it; deleting it promotes the
  newest remaining); `set_profile_photo` changes it. Lists, cards and the tree
  show it via `useProfilePhotos(treeId)` and `Avatar`.
- Phones upload with the native uploader (`expo-file-system/legacy`
  `uploadAsync`); `fetch(file).arrayBuffer()` sends a 14-byte scrap on
  Android. The photo viewer is a screen (`src/app/photo/[id].tsx`), not a
  Modal (Modals didn't draw correctly on Android).
- The app resizes before upload (`src/lib/photos.ts`: ≤1600 px and ≤400 px
  JPEG) — Supabase image transforms are a paid feature, so don't rely on them.
  On phones the picker's own crop screen opens after picking
  (`allowsEditing`; Android free crop and rotate, iOS square only); the web
  has none, so photos are used as picked there.
  Files are shown through short-lived signed links, never public URLs.
- Delete files before the row (the file rule checks the row). Deleting a
  person removes their photo rows but leaves the files (clean-up later);
  undoing a person's deletion doesn't bring photos back.

### Stories and memorials

- `supabase/migrations/20261121020000_stories_memorials.sql`: `stories` (title,
  body, language tag, author), `memorials` + `memorial_stewards`. Stories are
  read by everyone who can see the person; written by owners, editors and the
  person themself, and by any member on a memorial; edited by the author or a
  steward; deleted by author, the person, owners or stewards. Stewards also
  manage photos on a memorial. Owners turn memorials on with `set_memorial`
  (deceased only, stewards must be members, max 5).
- Stories and memorials are logged in History (`log_pk` knows `memorials`),
  so a deleted story can be undone. Stories are never machine-translated; the
  app shows "Written in …" when the language differs from the app's.
- App: `src/lib/stories.ts`, `src/components/PersonStories.tsx`,
  `src/app/person/[id]/story.tsx`, `src/app/person/[id]/memorial.tsx`.

### Birthdays and reminders

- `public.my_birthdays()` (security invoker): living people's birth day/month
  that the caller may see; RLS on `event_dates` does the privacy work.
- `src/lib/birthdays.ts`: next birthday, days away, age; 29 Feb → 28 Feb in
  other years (tested). Home shows the next 30 days (`Birthdays.tsx`).
- Reminders are local notifications (`expo-notifications`, `src/lib/reminders.ts`):
  switch per phone (AsyncStorage), 9:00 on the day, the next 60 days (max 40)
  re-planned whenever the list loads; tapping opens the person. No server,
  no push tokens. Not on the web.

### Website (myorbit.click)

- Hosted on Cloudflare (Workers static assets, free). `wrangler.jsonc` points
  at `./dist` with single-page-app fallback (any address → `index.html`).
  Cloudflare builds on every push to `main`: build command `npm run build:web`,
  deploy command `npx wrangler deploy`. Build variables set in Cloudflare:
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_WEB_URL=https://myorbit.click`. Node version: `.node-version`.
- Only static files: no server code, no data. The browser talks to Supabase
  directly; the database rules protect everything as on phones.
- `public/` is copied into the site: `_headers` (no search engines, no framing,
  basic browser protections) and `robots.txt`.
- Supabase Auth → URL Configuration: Site URL `https://myorbit.click`.
- Sign-in emails go through Resend (custom SMTP in Supabase), sent from the
  verified domain; the templates must contain `{{ .Token }}` (6-digit code).

### Database changes

- Every schema change is a new migration in `supabase/migrations/` (create it with
  `npx supabase migration new <name>`). Never edit a migration that has already
  been pushed; write a new one instead. Never change the schema in the Supabase
  dashboard.
- Every new table: enable RLS, `revoke all ... from anon`, grant only what
  `authenticated` needs, and write policies for select/insert/update/delete.
- Every policy gets tests in `tests/db/` that prove both what is allowed and
  what is blocked (other members, outsiders, signed-out visitors).
- Helper functions used by policies go in the `private` schema as
  `security definer` with `set search_path = ''`.
- Use `(select auth.uid())` in policies, not bare `auth.uid()`.
- `tests/db/supabase-stub.sql` is test-only; never copy it into a migration.
- After tests pass, I push with `npm run db:push`; don't push for me.

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
