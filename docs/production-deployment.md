# RASMALAI strict ₹0 public-beta deployment plan

> **Current direction (2026-11-14):** the owner asked to prepare a one-service Render Free beta. Use [`render-free-beta.md`](render-free-beta.md) and the root [`render.yaml`](../render.yaml) for that candidate. The Oracle/Tailscale-hosting proposal below is historical and was not executed. Neither approach is a public production approval.

**This is a guide, not permission to create resources or deploy.** No Oracle account, VM, DNS record, Supabase project, email sender, or public service was created or changed. The test project `rasmalai-test` and its records must remain untouched.

## Verdict

The best candidate under a hard ₹0/month ceiling is **one Oracle Cloud Always Free Ampere A1 VM**, with Next.js, one Socket.IO process, and Caddy on that VM; a separate Supabase Free project; a DuckDNS name; and Caddy/Let's Encrypt HTTPS. This is a **best-effort hobby/public beta**, not reliable production hosting: Oracle can reclaim an idle VM, Supabase can pause an inactive project, and the Supabase Free plan has no automatic backups or SLA. This tenancy's eligibility, region capacity, and free-quota status have not been checked, so Oracle is not yet confirmed available.

If the owner requires reliable always-on availability, backups, or guaranteed account recovery, the requirements conflict with ₹0. Do not pretend that an idle-reclaimable VM and pausable database provide production availability.

## Cost and free-tier limits

| Component | Planned cost | Material limits and risks |
|---|---:|---|
| Oracle A1 compute/network | ₹0 while every resource is within the Always Free allocation | 1,500 OCPU-hours and 9,000 GB-hours/month (equivalent to 2 OCPU/12 GB total) in the home region, plus up to 10 TB/month outbound data transfer. Capacity is not guaranteed. A1 VMs may be reclaimed if CPU p95, network, and memory are each below 20% over a 7-day window. The game service may be quiet enough to meet that threshold. |
| Supabase Free production project | ₹0 | 500 MB DB, 1 GB storage, 5 GB egress, 50,000 MAU, 200 Realtime concurrent connections and 2 million Realtime messages/month. Free projects may pause after 7 days of low activity. No automatic/downloadable dashboard backups; owner-managed logical exports are required. Maximum 2 active Free projects, so confirm the existing test project plus production fit the account limit. |
| DuckDNS | ₹0 | Free dynamic subdomain; owner must keep its IP record current and protect the update token. It is not a branded registered domain. Its documented updater supports address records and one TXT value; that may not satisfy an email vendor's complete SPF/DKIM record set. |
| Caddy + Let's Encrypt | ₹0 | Requires public DNS pointing at the VM and inbound TCP 80/443. Certificate issuance/renewal was not tested against a deployed hostname. |
| Email provider | ₹0 only if a free SMTP plan and sender verification work | Supabase's built-in mail service is for testing: it sends only to members of the Supabase organization and currently allows 2 emails/hour, with no delivery SLA. A free external SMTP plan may support public recipients, but domain verification and quotas must be proven first. |
| TURN | ₹0 only if self-hosted within the same VM and its free network allowance | Not configured. Existing voice uses STUN-only connectivity, which cannot guarantee calls through restrictive NATs/firewalls. A free public beta must disclose that limitation. |

**Expected monthly service bill: ₹0 only while all quotas and Always Free eligibility remain satisfied.** This is conditional, not a provider guarantee. Keep pay-as-you-go disabled, never upgrade, never provision a resource without an Always Free label and a ₹0 cost estimate, and stop if the console shows any charge. OCI sign-up normally requires card/debit-card verification and may place a temporary authorization hold; Oracle says it is removed and is not an actual charge unless the account is upgraded. If the owner will not accept card verification/temporary holds, Oracle is not an option. Do not use trial credits for paid-sized resources. Free-tier usage limits are not a promise of availability.

Current official limits checked 2026-11-14: [Oracle Always Free resources and idle reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Oracle public-egress pricing](https://www.oracle.com/cloud/networking/virtual-cloud-network/pricing/), [Oracle Free Tier signup and card verification](https://www.oracle.com/cloud/free/faq/), [Supabase Free plan quotas](https://supabase.com/pricing), [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [Supabase manual backups](https://supabase.com/docs/guides/platform/backups), [DuckDNS record API](https://www.duckdns.org/spec.jsp).

## Oracle availability and ARM compatibility

- A1 capacity is available only in the tenancy's home region. The region cannot be changed later. OCI documents `out of host capacity` as a possible temporary failure; do not upgrade or choose a paid shape to work around it. The owner must check the desired home region and A1 availability in their own console before proceeding.
- Oracle requires identity/card verification for most signups. It can place a temporary verification hold. This guide does not authorize signup or accepting a hold.
- OCI may reclaim an A1 instance after 7 days when CPU p95, network, and A1 memory utilization all remain below 20%. No synthetic traffic should be generated to evade this policy. Plan to restore from source plus Supabase data if reclaimed.
- The checked-in lockfile includes Linux ARM64 variants for Next SWC, Tailwind Oxide, Sharp, and esbuild. Prisma documents Linux ARM64 glibc support. The Dockerfile uses the official Node 22 Debian/glibc image, which publishes ARM64. **This is source/lockfile compatibility evidence only**: no native ARM64 container build or live A1 run has been tested. Build on the ARM64 VM before exposing it publicly. Sources: [Prisma Linux ARM64 system requirements](https://www.prisma.io/docs/orm/v6/reference/system-requirements), [official Node image architectures](https://hub.docker.com/_/node).
- Stay under the A1 Always Free limits, use an Ubuntu ARM64 image, and select only resources shown as Always Free. Avoid load balancers, paid backup add-ons, paid storage, extra IPs/resources, and non-free trial resources. OCI advertises 10 TB/month Always Free egress, but exceeding included resources can lead to billing on an upgraded tenancy. With the no-upgrade rule, do not raise any limit; stop service if limits are reached. Review the cost estimator and usage page before and after every change.

## Supabase Free and account email

Create a **new production project on Free** only after owner approval; never promote or repurpose `rasmalai-test`. Use the same reviewed 12 migrations only after checking the new project's status, taking a manual backup, and receiving explicit approval to apply them. Do not use `db push`, reset, or production credentials in local files.

Supabase Free currently includes 500 MB database, 1 GB storage, 5 GB egress, 50,000 MAU, and Realtime capacity of 200 concurrent connections/2 million messages monthly. Inactive projects can pause after a week of low activity. Free has no automatic database backup and dashboard backups are not downloadable. A Supabase CLI `db dump` excludes managed `auth` and `storage` schemas; database dumps also do not include Storage object bytes. So a SQL dump alone does **not** recover accounts or avatar files. The owner must separately plan/export Auth users and preserve Storage objects, then rehearse the entire recovery into a separate disposable project. Without that recovery plan, the Free database is not safe for important public user data.

For a logical database backup after an approved production project exists, install the Supabase CLI locally and make the admin Session Pooler URL available only in a protected operator shell as `DIRECT_URL`. The documented CLI supports:

```sh
supabase db dump --remote="$DIRECT_URL" -f schema.sql
supabase db dump --remote="$DIRECT_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
supabase db dump --remote="$DIRECT_URL" -f roles.sql --role-only
```

These commands were not run. Store output encrypted outside the repository. `schema.sql`, `data.sql`, and `roles.sql` do not include all Supabase-managed Auth/Storage state; use Supabase's account/data export guidance and a separate object download/restore plan. Restore only into a disposable project first, review default grants/RLS, and do not point restore commands at production casually. See [Supabase CLI backup guidance](https://supabase.com/docs/guides/platform/backups) and [CLI dump exclusions](https://supabase.com/docs/reference/cli/supabase-db-dump).

Email confirmation and password recovery must stay enabled. Supabase's shared default SMTP is not a public-signup solution: it only sends to organization team members, at 2 messages/hour currently, with best-effort delivery. Do not disable confirmation to get around this. A free external SMTP option is worth testing only if it supports public recipient addresses, SMTP, sender verification, and strict no-overage behavior. For example, Resend advertises a free limit of 3,000 emails/month and 100/day, but requires sender-domain DNS verification; never enable paid overages. [Supabase SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp), [Resend Free limits](https://resend.com/pricing), [Resend SPF/DKIM verification](https://resend.com/migrate/mailchimp-to-resend).

DuckDNS is suitable for the website TLS hostname, but its documented single TXT value is not proven sufficient for a transactional-mail domain's separate DNS records. **Public confirmation/reset email remains blocked until a free sender domain is verified and a real confirmation and recovery email successfully arrive.** Do not change Supabase auth settings or switch providers as part of this guide.

## Production configuration (names only)

Use the existing names-only template at [`deploy/production-env.names.example`](../deploy/production-env.names.example). Do not copy actual secrets into repository files. Keep protected environment files outside the repo with owner-only permissions; mount the Supabase CA read-only at the configured path.

- Web runtime: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_REALTIME_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `SPECTATOR_MODE_ENABLED`.
- Realtime runtime: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `REALTIME_ALLOWED_ORIGIN`, `NEXT_PUBLIC_SITE_URL`, `REALTIME_HOST`, `REALTIME_PORT`, `SPECTATOR_MODE_ENABLED`.
- One-off migration runner only: `DIRECT_URL`.
- Host-side Compose inputs: `PUBLIC_DOMAIN`, `WEB_ENV_FILE`, `REALTIME_ENV_FILE`, `SUPABASE_CA_CERT_FILE`.

Use `https://<chosen-name>.duckdns.org` as `NEXT_PUBLIC_SITE_URL` and the exact same origin for `REALTIME_ALLOWED_ORIGIN`. Leave `NEXT_PUBLIC_REALTIME_URL` empty so the client uses same-origin `/socket.io/` and Caddy upgrades it to WSS. Set `SPECTATOR_MODE_ENABLED=false` in both processes. Both runtime `DATABASE_URL`s use the restricted `prisma` Transaction Pooler and `sslmode=verify-full` with the production CA path; `DIRECT_URL` is the admin Session Pooler used only by the migration runner. Never set `DIRECT_URL` in app containers. Only Supabase publishable config is allowed in browser variables; secret key and DB URLs are server-only.

## Beginner setup order — do not execute until owner authorizes resource creation

1. **Confirm the zero-cost risks.** Decide whether Oracle's required card verification and temporary authorization hold are acceptable. Check whether the free OCI account already exists. Choose an India home region only after checking it is selectable; it is irreversible. If A1 capacity is unavailable, stop. Do not upgrade, enable pay-as-you-go, or use a paid resource.
2. **Check the free account limits.** In OCI Free Tier console, inspect Always Free limits and cost estimator. Proceed only if A1, its boot volume, and internet access are explicitly ₹0/Always Free. Keep total A1 at or below 2 OCPU/12 GB. Do not create a load balancer. Configure cost/usage alerts, but remember alerts are not a hard spending cap.
3. **After approval, create one Ubuntu ARM64 A1 VM** within those limits. Restrict SSH to the owner's IP or use a secure remote administration path. Allow inbound 80/443 only for public app traffic; never expose 3000/4100. Apply host firewall rules and unattended security updates. If OCI presents a non-zero estimate, cancel.
4. **Create the DuckDNS name** in the owner's DuckDNS account and point its A record at the VM public IP. Keep its update token private. Test DNS from outside the home network. Caddy will obtain/renew HTTPS certificates over public HTTP/TLS validation; do not use Tailscale Funnel.
5. **Check free email before opening public signup.** Choose a no-cost SMTP sender with no paid overages, verify that its DNS requirements can be met with the chosen free DNS, configure it only in the separate production Supabase project's Auth SMTP settings, and test signup confirmation plus password recovery to an external mailbox. If sender verification fails or the provider asks for payment, stop; do not disable email confirmation.
6. **Create a separate Supabase Free project** in Mumbai if the account's two-active-project limit allows it. Keep `rasmalai-test` and all its data. Set the exact HTTPS Site URL and callback allowlist after the DuckDNS hostname exists. Enable confirmed email/password only; leave phone login and spectator mode disabled. Configure approved avatar storage and reviewed security settings.
7. **Prepare database access without exposing admin credentials.** Create the restricted `prisma` runtime role using the reviewed project SQL. Save runtime variables in protected web/realtime host files and keep the migration admin URL in a separate temporary operator file. Download the production CA. Before applying anything, check migration status, take a logical dump, review all 12 migration files, then apply in order only after owner approval. Verify policies/grants and test restore separately.
8. **Build and run the provided single-host stack.** On the ARM64 VM, install Docker Engine/Compose, copy source and protected files, set only the host-side variables above, then follow the commands in the deployment section below. Keep one realtime process. Do not create a second realtime replica.
9. **Verify before inviting users.** Check certificate validation, HTTPS/WSS, every Next asset, Auth confirmation/reset emails, protected routes, profiles, rate limits, storage, and an authorized test match. Check OCI and Supabase usage against free limits. Keep a manual backup and documented restore path.

### Run and rollback

The checked-in files are `deploy/Dockerfile`, `deploy/compose.yaml`, and `deploy/Caddyfile`. `PUBLIC_DOMAIN`, `WEB_ENV_FILE`, `REALTIME_ENV_FILE`, and `SUPABASE_CA_CERT_FILE` belong in a host-only Compose interpolation file. Once the owner has approved the hostname and resources, on the VM run from the project root:

```sh
docker compose --env-file /etc/rasmalai/compose.env -f deploy/compose.yaml config
docker compose --env-file /etc/rasmalai/compose.env -f deploy/compose.yaml up -d --build
docker compose --env-file /etc/rasmalai/compose.env -f deploy/compose.yaml ps
```

Inspect logs without printing environment values; verify `https://<chosen-name>.duckdns.org/health` and `/login`, plus an authenticated WSS connection and a small authorized test room. Caddy routes `/socket.io/` to the realtime process. App containers are not published directly. Stop and roll back to the previous image/source version if health or auth checks fail. Database schema changes are **not** rolled back by resetting; use only a reviewed forward migration. Restore a manual database dump into a separate project first. Do not overwrite production or delete user/game data.

## Render Free — current zero-cost beta candidate

A single-service reverse-proxy configuration is now prepared and documented in [`render-free-beta.md`](render-free-beta.md). The two app processes stay on loopback and share one public Render `PORT`; Next routes and Socket.IO are dispatched by path. Whether the measured runtime memory leaves safe headroom under 512 MB is a release gate. Render Free's 0.1 CPU, 15-minute idle sleep, roughly one-minute cold start, ephemeral filesystem, possible restarts, and Hobby included limits make this a best-effort beta only. Do not describe it as 24/7 or production-ready. [Render Free limits](https://render.com/docs/free), [Render compute sizes](https://render.com/docs/compute-plans), [Render bandwidth allowance](https://render.com/docs/outbound-bandwidth), [Render build-pipeline limits](https://render.com/docs/build-pipeline).

## Unverified / launch blockers

- No OCI tenancy eligibility, home region, A1 capacity, or bill estimator was inspected. No resource was created.
- No Supabase production project, migrations, backups, SMTP provider, auth redirect, domain, DNS, or public HTTPS certificate was configured.
- No container runtime was available during preparation. Compose YAML parsed locally, but Docker image build, ARM64 runtime, Caddy config/runtime, and OCI networking are untested.
- Supabase free inactivity pause and backup limits are incompatible with a reliability promise. Manual backup/restore needs a rehearsed procedure.
- Public email auth needs a verified free SMTP sender; default Supabase SMTP cannot serve arbitrary public addresses.
- Reported Android online Ludo dice failure remains unresolved in live testing. Four-player live synchronization, cross-device two-way voice, spectator feature (disabled for launch), production abuse/load/security, and long-duration server continuity remain unverified/blockers. See [`LAUNCH_READINESS.md`](../LAUNCH_READINESS.md).

The ₹0 plan is acceptable only if the owner explicitly accepts these best-effort availability and data-recovery limits. Otherwise public launch must wait; changing the budget is an owner decision.
