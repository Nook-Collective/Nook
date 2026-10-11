# Nook

Invite-approved, Discord-style text chat for a small community.
Runs on Cloudflare's free tier. Sign-in is handled by Supabase Auth (GitHub).

## Status

- [x] Milestone 0: project scaffold
- [x] Milestone 1a: GitHub sign-in, token verification, account state, first admin
- [x] Milestone 1b: application form with Turnstile bot protection, pending page (this update)
- [ ] Milestone 2: admin review dashboard
- [ ] Milestone 3: channels and message history
- [ ] Milestone 4: real-time chat over WebSockets
- [ ] Milestone 5: moderation and roles
- [ ] Milestone 6: hardening, limits, deploy guide

Nothing in this repo deploys anything. There is deliberately no `deploy` script yet.

## How sign-in and applying work

1. The browser signs in through Supabase with GitHub and receives an access token.
2. Every API call sends that token. The Worker checks its signature against
   Supabase's public keys (no passwords or secrets involved).
3. Supabase only proves WHO someone is. What they may DO comes from the
   `members` table in our own database, checked on every protected request.
   A signed-in person with no row has not applied ("none").
4. To apply, a person enters a name and an optional note and passes a Turnstile check.
   The Worker validates the input, verifies the Turnstile token with Cloudflare
   (the widget alone proves nothing), and only then adds a `pending` row.
5. Applications stop when `MAX_PENDING_APPLICATIONS` are waiting for review.

What we collect: a name and a note, both typed by the applicant and NOT verified.
An admin must not treat them as proof of identity. (Supabase's own `user_metadata`
is editable by the user, so we do not use it for anything.)

## Setup outside this repo (your own accounts)

See Milestone 1a notes: GitHub OAuth App, Supabase GitHub provider (Email provider off),
Supabase redirect URL for your dev address, project URL and publishable key in `.dev.vars`.

Turnstile: local development uses Cloudflare's published TEST keys (already in
`.dev.vars.example`). They always pass and need no widget or hostname setup.
Real keys come from Cloudflare dashboard -> Turnstile -> Add widget, and are needed only
when deploying (with your approval). The real secret key is set with `wrangler secret put`.

## Local setup

```
npm install jose @supabase/supabase-js
cp .dev.vars.example .dev.vars        # first time only; then edit your two Supabase values
npm run cf-typegen
npm run db:migrate:local              # applies any new migrations
npm test
npm run typecheck
npm run dev
```

If you already have a `.dev.vars`, add the two TURNSTILE lines from `.dev.vars.example` to it,
then restart `npm run dev`.

## Check the database by hand

```
npx wrangler d1 execute DB --local --command "SELECT user_id, status, role, display_name, note FROM members"
```

## Create the first admin (local database)

1. Sign in with GitHub in the app.
2. In Supabase -> Authentication -> Users, copy your user's ID (a UUID).
3. Run (replace the placeholder; keep the quotes):

   ```
   npx wrangler d1 execute DB --local --command "INSERT INTO members (user_id, status, role) VALUES ('PASTE-USER-ID-HERE', 'approved', 'admin') ON CONFLICT(user_id) DO UPDATE SET status = 'approved', role = 'admin', updated_at = CAST(strftime('%s', 'now') AS INTEGER)"
   ```

If you already applied through the form, this changes that same row to approved admin.
There is no public endpoint that can create an admin.

## Layout

- `src/worker/`  API. `app.ts` routes, `auth.ts` verifies tokens, `turnstile.ts` checks bot tokens,
  `validate.ts` checks applicant input, `members.ts` is the only code that touches the database.
- `src/web/`     Preact frontend.
- `src/shared/`  Types and limits used by both.
- `migrations/`  Database migrations (applied in order, never edited after they ship).
- `test/`        Tests. Tokens are signed with throwaway keys, so no network or secrets.

## Secrets

Never commit secrets. Local values live in `.dev.vars` (git-ignored); `.dev.vars.example`
lists names only (the Turnstile values in it are Cloudflare's public test keys).
The Supabase secret and service_role keys are never used by this project.
