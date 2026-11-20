# Family & Friends

An Expo and TypeScript app for keeping a private list of your immediate family and friends. The first phase supports email/password accounts, a personal profile, and parent, spouse, child, and friend connections on iOS, Android, and web. Connections are shadow profiles, not login accounts.

## Setup

1. Install a supported Node.js version: 22.13 or newer in the 22.x line, 24.3 or newer in the 24.x line, or 26.x or newer. Install npm as well.
2. Create a Supabase project. Run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor **once** on a new project.
3. Enable email authentication in Supabase. If email confirmation is enabled, confirm the account through the email before signing in.
4. Create a `.env` file in the project root using the project's public URL and publishable/anon key:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
   ```

   These values are included in the app bundle. Never put a Supabase service role or secret key in the app.
5. Run `npm install`, then `npm run web` for the browser or `npm start` and open the project in Expo Go for iOS or Android. Restart Expo after changing `.env`.

Run `npm run typecheck` to check TypeScript, or `npx expo export --platform web` to build the web app.

## Privacy and roadmap

Row-level security restricts profiles and relationships to their creator. This initial version does **not** share data between accounts; adding a person does not send an invitation. Interactive graphs, invite-and-claim, collaborative editing, field-level privacy, media, reminders, GEDCOM, and memorials are future work. Do not use this MVP for sensitive family information until the appropriate sharing and privacy features are implemented.
