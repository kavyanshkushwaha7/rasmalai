# RASMALAI

A social board gaming platform. This checkout implements Phase 1 authentication and profiles, Phase 2 social features, Phase 3 local offline games, Phase 4 online multiplayer and player communications, and the Phase 5 spectator implementation. **Spectator Mode is DISABLED FOR LAUNCH** with the server-controlled `SPECTATOR_MODE_ENABLED=false` default. Its routes, UI, invitations, chat, and realtime delivery are blocked while disabled; this is not a passed spectator feature test. The implementation and database records are retained and the feature can be re-enabled after proper testing. Phase 6 release hardening is in progress; the configured Supabase test project has migrations `0001` through `0012` applied. The social-action rate-limit migration and grants are live on the test project, but end-to-end social quota behavior and other launch checks remain unverified; see [LAUNCH_READINESS.md](LAUNCH_READINESS.md). See [docs/project-plan.md](docs/project-plan.md).

## Architecture

- `apps/web`: Next.js App Router, Supabase Auth and Storage, plus server-rendered social pages and authenticated server actions for player search, friend relationships, messaging, and notifications.
- `packages/game-engine`: pure TypeScript engines shared by local React boards and the authoritative online service.
- `apps/realtime`: Express and Socket.IO. Authenticated room operations verify Supabase sessions and roster membership, then use trusted database RPCs for state, chat, presence, and results.
- `packages/database`: Prisma schema and PostgreSQL adapter. User-scoped operations accept an access token, verify it through Supabase Auth, then set transaction-local `authenticated` role and claims for RLS.
- `packages/database/prisma/migrations`: profile, social, messaging, Storage, online game, spectator, shared rate-limit, and rematch foundations. Migration `0012_disable_spectator_client_reads` tightens direct authenticated spectator read access without deleting spectator records or disabling server-only RPCs. Game and social writes use narrow `SECURITY DEFINER` functions that derive the caller from verified `auth.uid()` claims; client mutation RPC access is revoked by `0011`.

## Roadmap: in-game communication

Phase 4 reuses all three Phase 3 engines for online Ludo (four players), Tic Tac Toe (two), and Snakes & Ladders (two to four). It includes public and invite-only rooms, server-validated turns and cryptographic dice, reconnection, private player chat/reactions, result/stat persistence, match history and opt-in WebRTC voice. Phase 5 spectator code and schema remain available for future use, but **Spectator Mode is DISABLED FOR LAUNCH**. Set the same server-only `SPECTATOR_MODE_ENABLED=false` value in the web and realtime environments; it defaults to false if unset. When disabled, spectator UI and invitations are hidden, direct watch routes show “Spectator Mode is coming soon,” socket actions are rejected, and existing spectator sockets are removed from spectator channels before further room data is broadcast. This disablement is not a passed spectator feature test. It can be re-enabled only after proper authorization, privacy, and multi-account testing. Voice starts only after explicit Join and microphone permission; audio is never recorded. Player game experiences remain available. No paid relay or TURN service is configured.

Voice uses small-room peer-to-peer WebRTC with Socket.IO for authenticated signaling. STUN can avoid a media relay when direct connectivity works, but some networks need TURN; relayed media can incur hosting, bandwidth, and egress costs. Before any paid TURN/hosting service is introduced, the implementation plan requires a current cost estimate for expected concurrent matches. Phase 5 spectators do not join voice. See [docs/project-plan.md](docs/project-plan.md) for security, test, and release requirements.

## Phase 3: Local offline games

Open `/games` for the game lobby. Tic Tac Toe supports two local players; Ludo and Snakes & Ladders support two to four. Setup, turns, movement, and match state stay in the browser and require no Supabase account, database connection, or realtime service. Refreshing the page starts a new local session; match history is not persisted.

Rules are explicit and consistent between the pure engines and the UI:

- **Tic Tac Toe:** X starts; players alternate on empty cells; a row, column, or diagonal wins; a full board without a line is a draw.
- **Snakes & Ladders:** Roll from the start toward square 100; ladders and snakes apply immediately on landing; overshooting 100 leaves the token in place and ends the turn; sixes do not grant extra rolls.
- **Ludo:** Roll six to launch a token; every six grants another turn; star squares and all four start squares are safe; landing on an opponent on another shared square sends that token to its yard; exact rolls are needed to finish; the first player to bring all four tokens home wins. Friendly stacks do not block movement, and there is no three-sixes penalty.

The Ludo, Tic Tac Toe, and Snakes & Ladders logic is exported from `packages/game-engine` and does not call Supabase. These local games continue to work without an account or network; the online server imports the same rule engines and adds authoritative persistence separately.

Each board uses responsive app components with original CSS/SVG artwork rather than a flattened mockup. Ludo highlights all legal tokens and supports tapping a specific token on the board; Snakes & Ladders draws and animates the configured snake and ladder routes; Tic Tac Toe highlights the winning marks and animates the winning line. Game motion follows the device's reduced-motion setting.

The web app includes a PWA manifest and service worker for local play. It pre-caches `/games` and the three offline game pages plus their static Next.js assets. Cached game-page navigation is network-first with an offline fallback; private, social, online-match, auth, and API routes are never cached. Service workers require HTTPS or localhost. Open the games while online once to ensure this browser has installed the worker and saved the pages. Game progress remains in memory and does not persist across refreshes, including offline refreshes.

Phase 6 release checks and the evidence-based Passed/Failed/Blocked checklist are in [LAUNCH_READINESS.md](LAUNCH_READINESS.md). Automated build and policy tests pass, but live two-account flows, real browser-offline use, WebRTC between devices, distributed abuse controls, accessibility and production-hosting checks remain release gates. Do not treat a successful build or migration status as live security certification.

## Render Free beta preparation

A one-service Render Free/₹0 beta definition is prepared in [`render.yaml`](render.yaml), with the runtime proxy and configuration steps in [`docs/render-free-beta.md`](docs/render-free-beta.md). It has not been deployed. Render Free is a sleeping beta service with strict memory/CPU, bandwidth and uptime limits, not reliable public production hosting. Keep `rasmalai-test` separate; production Supabase, sender email, database backup/restore and live acceptance remain blockers. Do not connect the private repository or create a Render resource until the owner explicitly approves.

## Google OAuth for the controlled beta

Google sign-in UI and secure PKCE callback support are prepared. The owner reports Google is configured in Mumbai Supabase; that provider setup has not been independently verified or live-tested. `GOOGLE_OAUTH_ENABLED` remains false in the Render template and local examples. The beta uses `AUTH_BETA_MODE=invite-only-google` and a private server-side `BETA_ALLOWED_EMAILS` list; web requests and realtime sockets enforce the same verified-email/Google-identity allowlist. Email/password code remains available in the default local mode but is blocked server-side in invite-only beta mode. See [docs/google-oauth-free-beta.md](docs/google-oauth-free-beta.md) for setup verification, callback configuration, identity-linking caveat, and manual test plan.

## Create and configure Supabase

For the separate owner-reported Mumbai production project, follow the read-only verification and approval-gated setup in [docs/supabase-production-mumbai.md](docs/supabase-production-mumbai.md). The production project has not yet been independently verified or configured; keep the existing local environment files pointed at `rasmalai-test`.

1. Create a project in the [Supabase Dashboard](https://supabase.com/dashboard). Save the database password in a password manager.
2. In **Project Settings → API**, copy the Project URL, `sb_publishable_...` key, and a `sb_secret_...` key. The publishable key is safe for browser use. Store the secret key only in the web server’s secret environment; never put it in a `NEXT_PUBLIC_` variable or frontend bundle.
3. In **Database → Settings → SSL Configuration**, download the project CA certificate and enable **Enforce SSL on incoming connections**.
4. In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and allow:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/auth/callback?next=/profile/setup`
   - `http://localhost:3000/auth/callback?next=/reset-password`
   Add the deployed site’s exact callback URLs before production use.
5. For local/test email-password flows, use **Authentication → Sign In / Providers → Email**, keep confirmation enabled, and configure SMTP plus the allowed `/auth/callback?next=/profile/setup` and `/auth/callback?next=/reset-password` redirects. For the Google-only controlled production beta, follow [docs/google-oauth-free-beta.md](docs/google-oauth-free-beta.md) instead; that guide explains how to block direct email/password signup in the production Auth provider after reviewing existing users. Phone login remains disabled and marked Coming soon. Enabling it later requires an external SMS provider and may incur message and sender-number costs.

### Create the restricted runtime role

As the Supabase project database administrator, create the runtime role once. The role is a member of `authenticated` because the application switches into that role inside each user-scoped transaction; it must not own tables or have `BYPASSRLS`. To keep the role password out of SQL Editor history, create the role without a password, then set it interactively from an admin `psql` session with `\password prisma`.

```sql
create role "prisma" login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant authenticated to "prisma";
```

The `\password prisma` command is a `psql` meta-command, not SQL; it prompts without echoing the new password. Do not put the password literal in dashboard SQL, shell history, a connection URL in a command line, or chat. Role creation and password setup are writes: verify the target project and obtain owner approval before running them.

This SQL is for a separate Supabase project only. The configured test project already has the restricted runtime role. Authenticated users receive column-limited public profile and participant-scoped social/game reads; social and game mutations go through owner-checked functions. The `prisma` role can execute only the narrow room/game RPCs and does not receive direct access to the private room-summary helper.

## Environment variables

Keep application and migration credentials in separate environment stores. Copy the root `.env.example` to `apps/web/.env.local`. Copy `packages/database/.env.example` to `packages/database/.env` only for trusted migration work. Copy `apps/realtime/.env.example` to `apps/realtime/.env` if running the realtime service separately.

| Variable | Location | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Web | Supabase Auth and Storage endpoint |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web | Public Supabase key; not a secret |
| `NEXT_PUBLIC_SITE_URL` | Web | Origin used to form Auth callback links |
| `AUTH_BETA_MODE` | Web and realtime servers | `email-password` locally; set `invite-only-google` for the controlled beta |
| `GOOGLE_OAUTH_ENABLED` | Web and realtime servers | Server-side Google OAuth switch; remains `false` until beta allowlist, Render origin, and live acceptance are reviewed |
| `BETA_ALLOWED_EMAILS` | Web and realtime servers | Comma-separated, server-only invited email allowlist; empty denies all beta access |
| `SUPABASE_SECRET_KEY` | Web server only | Server-side Storage operations after user verification and image validation |
| `DATABASE_URL` | Web and realtime servers only | Restricted Prisma runtime role connection with `sslmode=verify-full` and `sslrootcert=certs/prod-ca-2021.crt` |
| `DIRECT_URL` | `packages/database/.env` only | Project-admin connection used by Prisma migrations |
| `NEXT_PUBLIC_REALTIME_URL` | Browser | Socket.IO endpoint. HTTPS pages use HTTPS/WSS only; for secure local testing, point it at the private TLS endpoint described below. |
| `SUPABASE_URL` | Realtime service | Supabase Auth endpoint for socket session verification |
| `SUPABASE_PUBLISHABLE_KEY` | Realtime service | Public Supabase key used for Auth verification |
| `REALTIME_PORT` | Realtime service | Optional; defaults to `4100` |
| `REALTIME_HOST` | Realtime service | Optional bind address; defaults to `0.0.0.0`. Use `127.0.0.1` behind the private HTTPS test proxy. |
| `REALTIME_ALLOWED_ORIGIN` | Realtime service | Exact web origin allowed for Socket.IO; defaults to local web origin |

`DATABASE_URL` must use the restricted `prisma` role, not `postgres`. Obtain a Transaction pooler connection string from **Connect** and append `sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt`. The runtime resolves the CA path from the project root, reads the certificate, and configures TLS with certificate verification. The local `certs/` folder is ignored by Git. For deployment outside this checkout, provide the CA certificate on the server and set `sslrootcert` to its absolute path. `SUPABASE_SECRET_KEY` is used only by the server-only Storage helper. It is a high-value Supabase credential: limit deployment access and rotate it if exposed. Do not add it or a database URL under a `NEXT_PUBLIC_` name.

`DIRECT_URL` is admin-level and migration-only. Use a Session pooler or direct database endpoint and append `sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt`. The Prisma config resolves this project-root-relative path and rejects a missing certificate or insecure SSL mode. The database CA is public certificate material, but protect the database passwords. For local realtime development, the service reads the trusted `apps/web/.env.local`; deployed realtime instances need their own server-side `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `REALTIME_ALLOWED_ORIGIN`, and public endpoint configuration. Never add secrets to `NEXT_PUBLIC_` variables.

## Private HTTPS voice testing

On Android, microphone access is unavailable when RASMALAI is opened through the Mac's plain HTTP Wi-Fi address. Use the private, non-production test setup in [docs/secure-voice-testing.md](docs/secure-voice-testing.md). It uses Tailscale Serve for a tailnet-only HTTPS URL and a separate HTTPS/WSS Socket.IO endpoint; it does not use Funnel or change the production app. Voice remains opt-in, starts muted, and requires each player to grant microphone permission. The realtime server continues to validate the Supabase session and exact web origin.

## Apply database and Storage setup

Migrations `0001`–`0010` were applied to the configured Supabase test project in order. For another project, review the SQL, configure the migration-only `DIRECT_URL`, then run:

```sh
npm install
npm run db:validate
npm run db:generate
npm run db:deploy
```

`db:deploy` applies pending migrations from `packages/database/.env` using `DIRECT_URL`; it does not reset or push the schema. Migration `0003` hardens profile and Storage writes; `0004`–`0005` add social messaging; `0006` adds participant-only game reads, chat/reaction tables, presence, invites, and restricted server RPCs; `0007` removes direct runtime execution of the private room-summary helper; `0008` adds spectator invitations, presence, and separate spectator chat/reaction tables with guarded RPCs; `0009` adds shared PostgreSQL-backed request budgets; `0010` adds consent-based rematches while preserving each completed result; `0011` adds server-precharged social limits and restricts write RPCs to Prisma; `0012` removes direct client RLS reads granted to spectators while retaining their records and server-only RPC path. Migration `0012` changes no rows. See `SECURITY_REVIEW.md` for the security boundary and re-enable notes. Migrations `0001`–`0005` retain their profile, Storage, and social behavior. Avatar uploads are decoded, size-limited, and re-encoded to WebP by a server-only action, which writes only to the verified user’s folder.

The checked-in RLS policy `public_profiles_read` makes usernames, nicknames, profile photos, and game statistics public; timestamps are not granted for public reads. Email and phone remain in Supabase Auth and are not selected from the public profile table. The avatar bucket is public for viewing; authenticated direct uploads are disabled, and the server action writes only to the verified user’s UUID folder after image validation. Direct authenticated profile table writes are revoked in migration `0003`; profile creation/editing uses a security-definer function that derives the profile owner from `auth.uid()`. Social reads are limited to request participants, conversation members, and notification recipients. The database functions validate each write and never accept a caller-supplied actor ID. Friend-based conversations stop accepting new messages after unfriending; conversation history remains visible to its two participants. Game logic will need a separately scoped trusted write path.

## Run locally

Requirements: Node.js 24+ and npm 11+.

```sh
npm install
npm run dev
```

In a second terminal run:

```sh
npm run dev:realtime
```

Open `http://localhost:3000`; run `npm run dev:realtime` in another terminal. Keep `SPECTATOR_MODE_ENABLED=false` in `apps/web/.env.local`; the local realtime server reads that same file. In deployments, set the same server-only value on both web and realtime services. The realtime health endpoint is `http://localhost:4100/health`. The browser passes its current Supabase session access token as Socket.IO handshake auth `{ accessToken }`; invalid sessions are rejected. Production sockets require HTTPS/WSS. Voice uses a free STUN server only, so users behind restrictive NAT/firewalls may need a separately cost-reviewed TURN relay.

### Test online rooms from Android on the same Wi-Fi

Start both local services on the Mac. Open `http://<Mac-Wi-Fi-IP>:3000` on Android and sign in in that same Android browser: `localhost` and the Mac's IP are different browser origins, and browser profiles/in-app browsers do not share Supabase sessions. If a copied room link starts with `http://localhost`, replace that host with the Mac's Wi-Fi IP, or copy the link while the Mac browser itself is using the LAN-IP URL. The client targets the same host on port `4100` for realtime. Local realtime CORS accepts the Mac's active LAN interface on the app's web port; production remains exact-origin restricted. Confirm the Mac firewall permits local access to ports `3000` and `4100`.

Opening a room link calls the server's authorized resume/join flow automatically. It can take an open seat in a public room while the room is waiting, or use a valid player invitation for a private waiting room. Private rooms without an invite, full rooms, and matches already in progress are rejected. The public lobby intentionally lists only public rooms waiting for players; an empty list while the game service is disconnected is labeled as unavailable instead of “No public rooms yet.”

## Checks

```sh
npm run db:validate
npm run db:generate
npm run typecheck
npm test
npm run build --workspace @rasmalai/web -- --webpack
```

The automated tests cover access-token verification, Ludo routes/token choice, all local game rules, online turn authorization/server dice, offline service-worker cache boundaries/fallbacks, avatar validation, room/spectator invitation and state persistence, separate player/spectator chat isolation, direct-write/function denial, match results, shared rate-limit concurrency/reconnect/expiry, and temporary PGlite PostgreSQL integration tests applying the checked-in migrations. Tests exercise social invalid/duplicate attempts, per-user isolation, quota exhaustion, notification-read limits, mutation RPC grants, and migration rollback. Spectator Mode is disabled for launch: tests verify the default-off flag, event rejection, existing-socket eviction, and direct Supabase read denial; these are not a passed public spectator feature test. Re-enable and separately test spectator behavior with authorized accounts before restoring it. Other tests do not replace real browser-offline testing, WebRTC network testing, or account-level live social quota checks.

## Manual live acceptance checks

The configured test project has the schema and RLS metadata applied. Complete these account-level checks with two or more already-authorized test users:

1. Verify both users can read the public username, nickname, avatar, and statistics.
2. Verify user A cannot call the Data API to insert or update their stats/timestamps or user B’s row. Verify direct authenticated Storage upload/delete calls are denied; only the server action should accept a valid image, and it must save under the verified owner’s UUID folder.
3. Verify profile creation/editing succeeds through the web app, survives refresh and sign-out/sign-in, and only updates username, nickname, or the validated avatar path.
4. Test email confirmation, login, reset-password email, password update, and callback redirects using the configured provider.
5. Test non-friend message request submission, recipient accept/decline, accepted one-to-one conversation, unread message and notification counts, and read-state clearing. Confirm a third user cannot query either participant's messages.
6. Create a public room and an invite-only room; verify an uninvited player cannot join the private room, and all supported player counts start in their intended seats.
7. Play one turn in each online game, including Ludo token selection; reconnect during a match; confirm the final result updates stats/history for each player.
8. **Spectator Mode is DISABLED FOR LAUNCH.** Do not use Watch or send spectator invitations in the launch configuration. To re-enable after launch, set `SPECTATOR_MODE_ENABLED=true` in both server environments, restart both services, and run the public/private spectator authorization and isolation acceptance tests.
9. Confirm an unrelated account cannot read private room state, moves, player chat, or reactions. Direct spectator-table RLS reads are revoked by migration `0012`; spectator data remains stored for future use.
10. Join voice manually, check the browser microphone permission prompt, verify the initial muted state, mute/unmute/leave, and repeat on a second device/network. No recording should occur. STUN-only audio may fail on restrictive networks; do not configure paid TURN until its costs are reviewed.
11. Confirm invalid/missing access tokens are rejected by the realtime handshake. Inspect `pg_policies`, grants and runtime role attributes; check for dashboard-added permissive policies.

Live metadata verification does not prove full user-to-user behavior. Spectator Mode is **DISABLED FOR LAUNCH** and has not passed a feature acceptance test; it can be re-enabled after the dedicated multi-account testing above. WebRTC voice still needs two-device testing. The spectator lobby and private waiting-room access gate were inspected at desktop and 390px mobile sizes historically; see [TODAY_PROGRESS.md](TODAY_PROGRESS.md) for current results. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the reviewed security boundaries and known limitations.

## Production deployment preparation

The strict **₹0/month** best-effort deployment proposal, Oracle Always Free risks, Supabase Free limits, free-domain/email caveats, environment variable names, manual setup order, and rollback notes are in [docs/production-deployment.md](docs/production-deployment.md). This preparation is not a deployment; no cloud resources or production project have been configured. The free-tier plan is not considered reliable production hosting. Spectator Mode remains **DISABLED FOR LAUNCH**.
