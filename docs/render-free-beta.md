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

## Exact values to enter after the owner approves service creation

Create a **separate production Supabase Free project** first; do not use `rasmalai-test` as production. Use the Render hostname assigned to the service, for example `https://<service-name>.onrender.com` (do not copy this placeholder literally):

| Render key | Configure |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Exact HTTPS origin, with no path or trailing route |
| `REALTIME_ALLOWED_ORIGIN` | Exactly the same HTTPS origin |
| `NEXT_PUBLIC_SUPABASE_URL` | Production Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production project's publishable key |
| `SUPABASE_SECRET_KEY` | Production secret key; server-only |
| `DATABASE_URL` | Production `prisma` runtime-role Transaction Pooler URL, with the password URL-encoded and `sslmode=verify-full&sslrootcert=/etc/secrets/rasmalai-supabase-ca.crt` |
| `NEXT_PUBLIC_REALTIME_URL` | Leave empty; Socket.IO must use same-origin HTTPS/WSS |
| `SPECTATOR_MODE_ENABLED` | Keep `false` |

Do not configure `DIRECT_URL` on the web service. It is an admin migration credential and must only exist in a separately controlled, temporary migration shell when production migration work is explicitly approved.

Upload the matching Supabase CA certificate under Render **Environment → Secret Files** with filename `rasmalai-supabase-ca.crt`. Render makes it available as `/etc/secrets/rasmalai-supabase-ca.crt`. The CA is certificate material, but the file is kept out of Git; the database password remains secret. Do not add `.env` files or the certificate directory to Git.

In the production Supabase dashboard, after the Render hostname exists, set **Authentication → URL Configuration → Site URL** to the exact HTTPS origin. Add the exact redirect URL `https://<service-name>.onrender.com/auth/callback` under allowed redirect URLs. Preserve all existing test-project settings; do not change its Site URL.

`render.yaml` contains `sync: false` placeholders for all project-specific values. Render's Blueprint flow prompts for them initially. Never paste credentials into the Blueprint, README, terminal output, a public issue, or a Codex message. Set the publishable and server-only values in Render's Environment screen. Use a restricted database role, not `postgres`.

## Cost and availability — hard ₹0 boundary

- The service plan and Hobby workspace can be ₹0. The current Free web instance is **512 MB RAM and 0.1 CPU**; current Hobby allowance is 750 Free instance-hours per workspace per calendar month, 5 GB outbound bandwidth, and 500 build-pipeline minutes. Additional bandwidth/build usage can incur charges if a payment method is attached. Keep pay-as-you-go disabled and do not add a payment method; over-limit use should suspend traffic/builds rather than spend money. Check the Render Billing/Usage screen before any service creation because workspace terms and remaining shared quotas are account-specific.
- A Free service spins down after 15 minutes with no inbound HTTP request or WebSocket message. A new request or socket can wake it, often with about a one-minute cold start. It can restart at any time, has no persistent disk, and Render explicitly says Free instances are not for production applications. Socket disconnects during sleep/restart; clients need to reconnect and restore the database-backed room snapshot. Do not use external uptime pings to defeat sleep.
- A single service can sometimes remain awake with active game sessions, but its 0.1 CPU and 512 MB are a tight ceiling for Next, Socket.IO, the proxy, Prisma and concurrent games. A low-load beta is not an uptime or performance guarantee. This design must remain **NOT READY** if measured RSS approaches the memory limit or load tests show instability.
- Keep all lasting profiles, messages, avatars and match state in Supabase/Storage. Render's filesystem is ephemeral. Use a new production Supabase project, its own reviewed migrations and backup plan; do not promote the test database. Supabase production-project creation, migration review/application, email delivery and backup/restore setup remain manual blockers.
- The app's current voice design relies on direct WebRTC/STUN and no TURN relay is configured. HTTPS enables microphone APIs, but restrictive NAT/firewall paths can still fail; cross-device voice is not guaranteed.
- Estimated hosting/service charge is **₹0/month only if the service remains on Free, included workspace quotas are not exceeded, and no paid resource/payment method is enabled**. This does not include any optional domain/email expenses. Use the Render `onrender.com` hostname to avoid buying a domain.

## Private Git and secrets

The checked-in `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), root `/certs/`, `node_modules`, and Next build directories. `render.yaml` contains no credentials. This workspace copy has no `.git` directory, so its Git index/remote and GitHub private visibility could not be inspected. Before connecting a private repository, run these checks from the actual repository checkout:

```sh
git status --short
git check-ignore -v apps/web/.env.local packages/database/.env certs/prod-ca-2021.crt
git ls-files | rg '(^|/)(\.env($|\.)|certs/|.*\.(crt|pem|key|p12|pfx|der)$)' | rg -v '(^|/)\.env\.example$'
```

The ignore checks must show all local env/certificate paths ignored, and the tracked-file scan must not list credentials or certificates. If it lists any, stop and remove them from Git history/index before connecting Render; rotating any exposed real credentials is a separate owner action. Do not run `git add -f` on environment or certificate files.

## Safe setup order (when approved; no action performed yet)

1. In Render, confirm the workspace is Hobby/free, there is no payment method/pay-as-you-go, and enough free instance-hours, build minutes and bandwidth remain. Never select a paid plan, paid pipeline, persistent disk, or add-on.
2. Prepare a **separate private GitHub repository** after checking the ignore/tracked-file commands above. Add the reviewed files and `render.yaml`; do not upload local `.env` or `certs/` content.
3. Create a separate production Supabase Free project only after approval. Configure verified sender email, auth URLs, restricted `prisma` runtime grants, CA certificate, backups, and reviewed migrations. Do not use or mutate `rasmalai-test` for this.
4. In Render choose **New → Blueprint**, connect the private repository, and inspect that it proposes exactly one `rasmalai-free-beta` Free web service in Singapore. Do not approve any extra service or paid resource. Enter the exact public URL and production environment values only in Render's secure form. Upload the certificate as a secret file. Avoid a payment method and paid overages.
5. Before inviting players, verify `/health`, `/login`, static assets, confirmation/reset callback, exact-origin rejection, authenticated Socket.IO/WSS, room creation/join, sleep/reconnect, database persistence, rate limits, and memory under representative load. First deployment automatically starts the service; do not proceed until the owner approves that action.

No deployment or external service access is part of this preparation task.
