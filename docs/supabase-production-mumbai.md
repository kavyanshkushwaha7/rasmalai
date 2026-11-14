# Supabase Production Database — Mumbai

**Status: preparation only.** No production database connection, SQL, role creation, migration, or Supabase setting change was performed. The owner reports that `rasmalai-production-mumbai` was created in `ap-south-1`; the dashboard session available to this workspace is signed out, so its identity and region have not been independently verified.

The local `apps/web/.env.local` and `packages/database/.env` still identify the same existing test project. An ignored `packages/database/.env.production.local` skeleton now exists with an empty `DIRECT_URL`; it contains no credentials. The production CA and a populated production connection are still absent. Do not overwrite either test file or use its connection strings for production.

The owner reports a read-only check on the new project returned `public_tables=0`, `migrations_table_exists=false`, `auth_users=0`, `storage_objects=0`, and `avatars_bucket_exists=0`. Treat this as owner-reported evidence until the target project reference is confirmed and a read-only connection check is independently completed.

## 1. Confirm the target project

1. Sign in at the [Supabase Dashboard](https://supabase.com/dashboard) and select the project named `rasmalai-production-mumbai`.
2. Open **Project Settings → General**. Confirm the displayed project name and region are the intended Mumbai project (`ap-south-1`). Note its **Reference ID** privately and confirm it differs from the reference ID of `rasmalai-test`. A project name is not a unique identifier; the reference ID is.
3. Do not copy a test project URL, key, or database password into this production setup.

Supabase documents the Reference ID location under **Settings → General → Project Settings → Reference ID**. See [Supabase project references](https://supabase.com/docs/guides/graphql#term-reference).

## 2. Confirm it is empty (read-only)

In the selected production project's **SQL Editor**, run this read-only query. It checks migration history, RASMALAI public tables, Supabase Auth user count, and objects in the RASMALAI avatar bucket. It does not return account names or row contents.

```sql
WITH app_tables AS (
  SELECT count(*) AS table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = ANY (ARRAY[
      'profiles', 'friend_requests', 'friendships', 'user_blocks',
      'message_requests', 'conversations', 'conversation_members', 'messages',
      'game_rooms', 'room_players', 'spectators', 'game_states', 'matches',
      'match_players', 'game_moves', 'game_invites', 'notifications', 'user_reports',
      'game_chat_messages', 'game_chat_reactions', 'spectator_invites',
      'spectator_chat_messages', 'spectator_chat_reactions',
      'rematch_requests', 'rematch_votes', 'rasmalai_rate_limit_buckets'
    ]::text[])
)
SELECT
  current_database() AS database_name,
  current_user AS connected_as,
  to_regclass('public._prisma_migrations') IS NULL AS no_prisma_migration_history,
  (SELECT table_count = 0 FROM app_tables) AS no_rasmalai_tables,
  (SELECT count(*) = 0 FROM auth.users) AS no_auth_users,
  COALESCE((
    SELECT public
      AND file_size_limit = 4194304
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
    FROM storage.buckets
    WHERE id = 'profile-avatars'
  ), true) AS avatar_bucket_absent_or_matches_migration,
  (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'profile-avatars') AS no_rasmalai_avatar_objects;
```

Expected: all `no_...` columns and `avatar_bucket_absent_or_matches_migration` are `true`. If a check is false, stop and inspect the target before any write. In particular, `0001` upserts the `profile-avatars` bucket settings, so a pre-existing bucket with a different public/size/MIME configuration must be reviewed before migration. Share only the project reference and these booleans/counts if you want help verifying the result; never share passwords, connection strings, API keys, tokens, or user rows.

## 3. Get production connection details and CA

Use the production project dashboard, not a connection string from local test files:

1. Select **Connect** at the top of the project dashboard.
2. Copy the **Session pooler** connection details for the one-off admin migration connection. Use the copied host and username; for shared session pooling the usual port is `5432` and username format is `postgres.<PROJECT_REF>`. The dashboard is authoritative for host/username.
3. Copy the **Transaction pooler** connection details for the runtime role. For the shared pooler the usual port is `6543`; after the restricted `prisma` role exists, use username `prisma.<PROJECT_REF>`. Do not construct the pooler hostname from the region; copy it from **Connect**.
4. Find the production database CA certificate in **Database → Configuration / SSL Configuration** and download that project's CA. Keep it separate from the test CA, for example at `certs/rasmalai-production-mumbai-ca.crt`. The root `certs/` directory is ignored by Git.
5. Store the database password in a password manager. URL-encode reserved characters in the password portion only. Add `sslmode=verify-full` and `sslrootcert` pointing at the production CA. For an eventual Render secret file, use its absolute `/etc/secrets/...` path; for local migration verification, use the absolute local certificate path.

Supabase's current connection guidance says to obtain both pooler strings from **Connect**, that shared pooler hosts vary by cluster, and that `verify-full` requires the project CA. See [database connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres) and [Postgres SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).

### Configure only the local migration connection

After confirming the dashboard Reference ID, download the production CA into the ignored root `certs/` folder as `rasmalai-production-mumbai-ca.crt`. Open `packages/database/.env.production.local` in a local editor (do not use a command containing the URL/password, and do not paste either into chat) and add only this variable, filling placeholders from the production project's **Connect → Session pooler** panel:

```dotenv
DIRECT_URL="postgresql://postgres.<PROJECT_REF>:<URL_ENCODED_DATABASE_PASSWORD>@<SESSION_POOLER_HOST>:5432/postgres?sslmode=verify-full&sslrootcert=certs/rasmalai-production-mumbai-ca.crt"
```

Use the exact host and username copied from that project's dashboard, confirm `<PROJECT_REF>` matches **Settings → General → Reference ID**, and confirm it differs from `rasmalai-test` and any Seoul project reference. Do not add this URL to `packages/database/.env`, `apps/web/.env.local`, Render, or Git. The production file path is ignored by Git; a safe check is `git check-ignore packages/database/.env.production.local` (it should print the path only).

After saving the file, restrict local access with `chmod 600 packages/database/.env.production.local`. Keep the CA certificate in the already-ignored `certs/` folder; never add the certificate or `.env.production.local` to Git.

Once the file and CA exist, the read-only connection/status checks are:

```sh
cd packages/database
DOTENV_CONFIG_PATH="$PWD/.env.production.local" npx prisma migrate status
```

Prisma's configuration verifies `sslmode=verify-full` and resolves the CA path before connecting. `migrate status` only reads migration history; it does not apply migrations. For a further read-only identity check, connect with the copied Session Pooler host and project-ref username, then run `SELECT current_user, current_database();`; enter the admin database password only at the interactive prompt. Do not paste or print the connection URL. Before proceeding, verify the parsed project reference against the dashboard and ensure status reports no applied migration history. If the result is not the expected initial state, stop.

## 4. Keep production credentials separate

Do not copy test values. Do not populate the production environment file until you have confirmed the project reference and are ready for the later, read-only connection check.

- One-off local migration file: `packages/database/.env.production.local` (ignored by `.gitignore`'s `.env.*` rule; currently a blank `DIRECT_URL` skeleton with mode `0600`). It is for the production admin Session Pooler only. Keep `packages/database/.env` unchanged for the test project.
- Eventual Render runtime environment: configure production values in the Render service's protected Environment UI, not in Git or `DIRECT_URL`. Runtime uses the restricted `DATABASE_URL`, Transaction Pooler, and production CA secret file.
- Web and realtime on the single service use the same production Supabase Auth endpoint/key set, exact HTTPS site origin, `NEXT_PUBLIC_REALTIME_URL` empty (same-origin `/socket.io`), and `SPECTATOR_MODE_ENABLED=false`.
- Variable names required by the existing application are listed in [`production-env.names.example`](../deploy/production-env.names.example). `DIRECT_URL` must never be set in the web/realtime runtime.

The code's Prisma configuration resolves the CA path and rejects insecure SSL. `deploy/render-free.mjs` additionally rejects a runtime admin/direct URL, a non-`prisma` username, a non-Transaction Pooler port, mismatched origins, a non-HTTPS Supabase URL, or spectator mode enabled.

## 5. Migration dependency and safety review

Apply only to the verified empty production project, in the existing order `0001` through `0012`, using `DIRECT_URL` from the production admin Session Pooler:

| Migration | Purpose / dependency |
| --- | --- |
| `0001_phase1_foundation` | Creates base enums, profiles/social/game tables, indexes/FKs, initial profile and Storage policies. Depends on Supabase's existing `auth` and `storage` schemas and roles. It upserts the `profile-avatars` bucket to the intended public/read, size, and MIME configuration. |
| `0002_phase1_rls_hardening` | Enables RLS and revokes unfinished social/game table access. |
| `0003_phase1_security_hardening` | Adds avatar path, narrows public profile columns, routes writes through an `auth.uid()`-owned function, and replaces initial policies. A historical comment in this file says the migration was intentionally unapplied; that comment is stale for the already-migrated test project. Do not edit an applied migration file because that changes its checksum. |
| `0004_phase2_message_request_notifications` | Adds the notification enum value in an isolated migration before later functions use it. |
| `0005_phase2_social_messaging` | Adds direct-conversation uniqueness, participant-scoped reads, and guarded social RPCs. |
| `0006_phase4_online_games` | Adds online chat/reactions/presence and guarded game RPCs. Requires the `prisma` database role to exist because it grants server RPCs to that role. |
| `0007_phase4_restrict_room_summary` | Removes direct client execution of the private room-summary helper. |
| `0008_phase5_live_spectators` | Adds spectator invitations/chat/RPCs and temporary spectator RLS reads. |
| `0009_shared_atomic_rate_limits` | Adds the shared PostgreSQL quota table/function and legacy social insert triggers. |
| `0010_online_rematches` | Adds rematch requests/votes and round history; replaces the one-match-per-room uniqueness with one in-progress match per room; extends shared quota keys. Existing match rows are preserved. |
| `0011_social_action_rate_limits` | Extends quota keys, adds server-precharged social limits, revokes direct browser mutation RPC access, grants those RPCs to `prisma`, and removes the old insert triggers to avoid double charging. |
| `0012_disable_spectator_client_reads` | Replaces read policies so spectator rows no longer grant direct Data API access; retains spectator tables/RPCs and data. Runtime flag must also remain false. |

All function definitions reviewed use `SECURITY DEFINER` with fixed `search_path = pg_catalog`. The relevant RLS policies and RPC grants derive the user from `auth.uid()`; server mutations are restricted to the `prisma` role, while browser roles retain scoped reads. Migrations `0001`–`0012` contain no `DROP TABLE`, `TRUNCATE`, or top-level application-row deletion. They do include policy/index/constraint/function/trigger replacement. `0001`'s Storage bucket upsert changes bucket settings if a bucket of that ID already exists, so verify the project is fresh first. No test users, messages, matches, or other test records are copied.

The restricted `prisma` role must be created before migration `0006`. Role creation instructions exist in the README but have not been run on production. The role must not be a superuser, table owner, `CREATEDB`, `CREATEROLE`, replication, or `BYPASSRLS`; it needs the `authenticated` membership for transaction-local RLS context and receives only explicit server RPC grants in the later migrations. Setting its password interactively with `psql`'s `\password prisma` avoids putting a plaintext password in a SQL statement. Role creation is a database write and remains approval-gated.

The migrations are designed for an empty Supabase project and are dependency-ordered, not a data-copy process. Do not start the app against the new project until all 12 finish successfully: intermediate migrations intentionally transition grants/policies, and spectator reads are tightened in `0012`.

## 6. Backup and failure precautions

Supabase Free does not include automatic daily database backups. Supabase recommends manual logical exports using the Supabase CLI `db dump` command; see [Database Backups](https://supabase.com/docs/guides/platform/backups) and the [CLI dump reference](https://supabase.com/docs/reference/cli/supabase-db-dump). Before any approved migration, save a fresh schema-only export securely outside Git and verify the owner-reported empty state. Do not enable PITR or paid add-ons. Because this target is reported empty, there should be no application records to copy or restore.

There is no down-migration chain. If `migrate deploy` fails or leaves a migration marked failed, stop immediately: do not rerun blindly, use `db push`, reset, drop schemas/tables, or restore over the target. Preserve the database and migration history, inspect the exact failed migration state read-only, then prepare a reviewed forward-repair plan. Any restore that replaces the target is destructive and requires separate explicit approval; never use it as an automatic rollback.

## 7. Verification and approval gate

The read-only Prisma status command in section 3 must identify the production database and show the expected initial state before any migration step. If the target already records any migration, stop. After an approved role creation, verify `prisma` flags and its `authenticated` membership with read-only catalog queries; after migrations, verify function execute grants and RLS state the same way. Keep all outputs limited to names/booleans/counts.

**No migration or database write is approved by this guide.** Before creating `prisma` or applying any of the 12 migrations, stop and request the owner's explicit approval with the verified project reference, empty-state result, migration plan, backup artifact location, and failure/rollback precautions.
