# Nook

Invite-approved, Discord-style text chat for a small community.
Runs on Cloudflare's free tier. Sign-in is handled by Supabase Auth (GitHub).

## Status

- [x] Milestone 0: project scaffold
- [x] Milestone 1a: GitHub sign-in, token verification, account state, first admin (this update)
- [ ] Milestone 1b: application form with bot protection, pending page
- [ ] Milestone 2: admin review dashboard
- [ ] Milestone 3: channels and message history
- [ ] Milestone 4: real-time chat over WebSockets
- [ ] Milestone 5: moderation and roles
- [ ] Milestone 6: hardening, limits, deploy guide

Nothing in this repo deploys anything. There is deliberately no `deploy` script yet.

## How sign-in works

1. The browser signs in through Supabase with GitHub and receives an access token.
2. Every API call sends that token. The Worker checks its signature against
   Supabase's public keys (no passwords or secrets involved).
3. Supabase only proves WHO someone is. What they may DO comes from the
   `members` table in our own database, checked on every protected request.
   A signed-in person with no row has not applied ("none").

## One-time setup outside this repo (you do these in your own accounts)

1. **GitHub OAuth App.** GitHub -> Settings -> Developer settings -> OAuth Apps -> New.
   Homepage URL: your dev address. Authorization callback URL: the callback shown in
   Supabase under the GitHub provider (looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
   Create a client secret. Paste both values into Supabase only; never into this repo or a chat.
2. **Supabase -> Authentication -> Sign In / Providers.** Enable GitHub with that client ID and secret.
   Turn OFF the Email provider and leave anonymous sign-ins off, so GitHub is the only way in.
3. **Supabase -> Authentication -> URL Configuration.** Add your dev address (for Codespaces,
   the forwarded URL for port 5173 shown in the Ports tab) to the Redirect URLs list.
   Unlisted addresses are blocked and fall back to the Site URL.
4. **Keys.** Copy the project URL and the publishable key into `.dev.vars` (see below).
   Use the publishable key only.
5. **Check token keys.** Open `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
   in a browser. It should show a non-empty `keys` list. If it shows `{"keys":[]}`, tell me.

## Local setup

```
npm install jose @supabase/supabase-js
cp .dev.vars.example .dev.vars        # then edit .dev.vars with your two values
npm run cf-typegen
npm run db:migrate:local              # answer y when asked
npm test
npm run typecheck
npm run dev
```

## Create the first admin (local database)

1. Open the app and sign in with GitHub. You should see "You have not applied yet."
2. In Supabase -> Authentication -> Users, copy your user's ID (a UUID).
3. Run (replace the placeholder; keep the quotes):

   ```
   npx wrangler d1 execute DB --local --command "INSERT INTO members (user_id, status, role) VALUES ('PASTE-USER-ID-HERE', 'approved', 'admin') ON CONFLICT(user_id) DO UPDATE SET status = 'approved', role = 'admin', updated_at = CAST(strftime('%s', 'now') AS INTEGER)"
   ```

4. Reload the app. It should say you are approved as an admin.

Why this is safe: it needs access to your own machine (or later, your Cloudflare account).
There is no public endpoint that can create an admin. `--local` keeps it on this machine's
database; the same command with `--remote` is only for deployment, with your approval.

## Layout

- `src/worker/`  API. `app.ts` routes, `auth.ts` verifies tokens, `members.ts` reads the database.
- `src/web/`     Preact frontend.
- `src/shared/`  Types used by both.
- `migrations/`  Database migrations (applied in order, never edited after they ship).
- `test/`        Tests. Tokens are signed with throwaway keys, so no network or secrets.

## Secrets

Never commit secrets. Local values live in `.dev.vars` (git-ignored); `.dev.vars.example`
lists names only. The Supabase secret and service_role keys are never used by this project.
