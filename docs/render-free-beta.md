# RASMALAI on one Render Free service (₹0 beta preparation)

**Status: prepared, not deployed.** This guide and `render.yaml` describe one Render Free Node web service. They do not create a Render service, connect GitHub, create a Supabase project, apply migrations, or change the existing localhost/Tailscale setups.

## Architecture

Render terminates HTTPS and forwards all public traffic through its one assigned `PORT`. `deploy/render-free.mjs` binds that port on `0.0.0.0`, sends ordinary HTTP requests to Next.js on `127.0.0.1:13000`, and sends `/socket.io` polling and WebSocket upgrades plus `/health` to Socket.IO on `127.0.0.1:14100`. Neither internal port is public. The browser leaves `NEXT_PUBLIC_REALTIME_URL` empty, so the existing client uses the page's HTTPS origin and the standard `/socket.io/` path; Render carries the upgrade over the same TLS hostname. Realtime still checks the exact HTTPS `REALTIME_ALLOWED_ORIGIN` and verifies Supabase access tokens. The launcher refuses to start if the site and realtime origins disagree, the database CA is missing/unverified, or spectator mode is enabled.

This retains the existing two-server architecture instead of rebuilding game or authentication behavior. It adds a small parent process/reverse proxy and runs one web child plus one realtime child. The runtime memory result is in `LAUNCH_READINESS.md`; only measured evidence can establish whether this fits 512 MB.

## Render definition and commands

The root `render.yaml` is the single-service Blueprint. The configured commands are:

```sh
npm ci && RASMALAI_AUDIT_BUILD=1 npm run build
RASMALAI_AUDIT_BUILD=1 node deploy/render-free.mjs
```

It pins Node.js `22.22.0` (matching the existing Node 22 production container), selects the Free plan, one Singapore instance, manual deploys, and `/health`. The build uses the existing isolated `.next-audit-build` directory. The start process binds only the Render-provided public `PORT`; both application children bind loopback internal ports. The health endpoint returns 200 only when both Next `/login` and realtime `/health` answer successfully.

## Render values and production certificate

`NEXT_PUBLIC_SITE_URL` and `REALTIME_ALLOWED_ORIGIN` self-reference this service's `RENDER_EXTERNAL_URL`. Render assigns the actual HTTPS URL; the Blueprint does not hardcode a hostname. Render documents self-referencing a service by its own name, and configured environment variables are available during both build and runtime. See [self-referencing Blueprints](https://render.com/docs/blueprint-spec#self-referencing-environment-variables) and [Render's default environment variables](https://render.com/docs/environment-variables).

The Blueprint review should prompt for these five project-specific values:

| Render key | Configure privately |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Mumbai production project's URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Mumbai production project's publishable key |
| `SUPABASE_SECRET_KEY` | Mumbai production secret key; server-only |
| `DATABASE_URL` | Restricted `prisma` Transaction Pooler URL, password URL-encoded, with `sslmode=verify-full` and `sslrootcert=%2Fetc%2Fsecrets%2Frasmalai-supabase-ca.crt` |
| `BETA_ALLOWED_EMAILS` | Comma-separated invited, verified email addresses. It can remain empty while Google sign-in is disabled if Render permits an empty value. |

Beginner setup:

1. In the Blueprint review, confirm exactly one Free web service named `rasmalai-free-beta`. Enter the Mumbai production Supabase URL and publishable key from that project's dashboard.
2. Enter `SUPABASE_SECRET_KEY` directly into Render's protected value field. Never paste it into chat, source files, or a terminal command.
3. For `DATABASE_URL`, use the Mumbai project's Supabase **Connect → Transaction pooler** details and the restricted `prisma` runtime role. Confirm the username begins `prisma.`, the host ends in `.pooler.supabase.com`, and the port is `6543`. Use this role's password (URL-encode reserved characters). Add `sslmode=verify-full` and `sslrootcert=%2Fetc%2Fsecrets%2Frasmalai-supabase-ca.crt` to the query. Do not use the `postgres` admin account or its `DIRECT_URL`.
4. In Render **Environment → Secret Files → Add Secret File**, set filename `rasmalai-supabase-ca.crt` and paste the contents of `certs/rasmalai-production-mumbai-ca.crt`. The runtime reads it at `/etc/secrets/rasmalai-supabase-ca.crt`. Render documents secret files at `/etc/secrets/<filename>`; see [Render secret files](https://render.com/docs/configure-environment-variables#secret-files). This local file parses as a PEM certificate and is ignored by Git. Do not upload a test-project CA.
5. Put only the invited, verified addresses in `BETA_ALLOWED_EMAILS`. Leave `GOOGLE_OAUTH_ENABLED=false` as fixed in the Blueprint until you explicitly choose to activate Google after URL and allowlist review.
6. Before enabling sign-in, use the generated origin to configure the Mumbai Supabase Auth Site URL and allowed callback URL (`<generated-origin>/auth/callback`). This requires a separate owner action; this guide does not change Supabase settings.

The Blueprint sets `AUTH_BETA_MODE=invite-only-google`, `GOOGLE_OAUTH_ENABLED=false`, `SPECTATOR_MODE_ENABLED=false`, and leaves `NEXT_PUBLIC_REALTIME_URL` empty for same-origin HTTPS/WSS. It self-references the origin variables, so they should no longer be among the manual prompt fields. If the review still prompts for seven, refresh it after the updated Blueprint is pushed and synced.

**First-start certificate check:** the runtime intentionally refuses to start if the CA file is absent or TLS is not `verify-full`. Render documents Secret Files as a Dashboard **Environment → Secret Files** upload, separate from Blueprint `envVars`; saving a secret file triggers a deploy. Confirm the service setup flow lets you attach the CA before its first start. If the file can only be added after the service is created, the first process start will fail closed and need a subsequent deploy after the file is uploaded. Do not bypass this check by using `sslmode=require`, removing the certificate, or substituting an admin URL.

Do not configure `DIRECT_URL` on the Render service. It is an admin migration credential and belongs only in a separately controlled migration environment when an approved migration is required.

## Cost and availability — hard ₹0 boundary

- The service plan and Hobby workspace can be ₹0. The current Free web instance is **512 MB RAM and 0.1 CPU**; current Hobby allowance is 750 Free instance-hours per workspace per calendar month, 5 GB outbound bandwidth, and 500 build-pipeline minutes. Additional bandwidth/build usage can incur charges if a payment method is attached. Keep pay-as-you-go disabled and do not add a payment method; over-limit use should suspend traffic/builds rather than spend money. Check the Render Billing/Usage screen before any service creation because workspace terms and remaining shared quotas are account-specific.
- A Free service spins down after 15 minutes with no inbound HTTP request or WebSocket message. A new request or socket can wake it, often with about a one-minute cold start. It can restart at any time, has no persistent disk, and Render explicitly says Free instances are not for production applications. Socket disconnects during sleep/restart; clients need to reconnect and restore the database-backed room snapshot. Do not use external uptime pings to defeat sleep.
- A single service can sometimes remain awake with active game sessions, but its 0.1 CPU and 512 MB are a tight ceiling for Next, Socket.IO, the proxy, Prisma and concurrent games. A low-load beta is not an uptime or performance guarantee. This design must remain **NOT READY** if measured RSS approaches the memory limit or load tests show instability.
- Keep all lasting profiles, messages, avatars and match state in Supabase/Storage. Render's filesystem is ephemeral. Use the existing Mumbai production project; never promote or use `rasmalai-test` as production. Production initialization is owner-reported complete, but backup/restore and live app integration still need verification. Email delivery and backup/restore setup remain manual blockers.
- The app's current voice design relies on direct WebRTC/STUN and no TURN relay is configured. HTTPS enables microphone APIs, but restrictive NAT/firewall paths can still fail; cross-device voice is not guaranteed.
- Estimated hosting/service charge is **₹0/month only if the service remains on Free, included workspace quotas are not exceeded, and no paid resource/payment method is enabled**. This does not include any optional domain/email expenses. Use the Render `onrender.com` hostname to avoid buying a domain.

## Private Git and secrets

The checked-in `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), root `/certs/`, `node_modules`, build directories, and private backups. `render.yaml` contains no credentials. The current private GitHub repository was verified; tracked-file and ignored-path scans passed. Never add local environment files, certificate files, or private database backups to Git.

```sh
git status --short
git check-ignore -v apps/web/.env.local packages/database/.env certs/prod-ca-2021.crt
git ls-files | rg '(^|/)(\.env($|\.)|certs/|.*\.(crt|pem|key|p12|pfx|der)$)' | rg -v '(^|/)\.env\.example$'
```

The ignore checks must show all local env/certificate paths ignored, and the tracked-file scan must not list credentials or certificates. If it lists any, stop and remove them from Git history/index before connecting Render; rotating any exposed real credentials is a separate owner action. Do not run `git add -f` on environment or certificate files.

## Safe setup order (when approved; no action performed yet)

1. In Render, confirm the workspace is Hobby/free, there is no payment method/pay-as-you-go, and enough free instance-hours, build minutes and bandwidth remain. Never select a paid plan, paid pipeline, persistent disk, or add-on.
2. Use the existing private GitHub repository and confirm the latest reviewed `main` commit contains the Blueprint. Do not upload local `.env` or `certs/` content.
3. Use the existing Mumbai production Supabase project. Confirm verified sender email, Auth URLs, restricted `prisma` runtime grants, CA certificate, backups, and the applied migrations. Do not use or mutate `rasmalai-test` for this.
4. In Render choose **New → Blueprint**, connect the private repository, and inspect that it proposes exactly one `rasmalai-free-beta` Free web service in Singapore. Do not approve any extra service or paid resource. Enter the five project-specific values only in Render's secure form and upload the production CA as a Secret File. The origin values come from the service self-reference. Avoid a payment method and paid overages.
5. Before inviting players, verify `/health`, `/login`, static assets, confirmation/reset callback, exact-origin rejection, authenticated Socket.IO/WSS, room creation/join, sleep/reconnect, database persistence, rate limits, and memory under representative load. First deployment automatically starts the service; do not proceed until the owner approves that action.

No deployment or external service access is part of this preparation task.
