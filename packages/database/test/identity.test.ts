import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { withAuthenticatedUser } from "../src/index.js";
import { getVerifiedSupabaseUserId } from "../src/supabase-auth.js";

const userId = "a21aa111-5d0b-4e12-9a80-82db9ec88f03";
const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const originalServiceUrl = process.env.SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_PUBLISHABLE_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  if (originalServiceUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalServiceUrl;
  if (originalServiceKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
  else process.env.SUPABASE_PUBLISHABLE_KEY = originalServiceKey;
});

function configureAuth(response: Response) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  globalThis.fetch = (async () => response) as typeof fetch;
}

test("verified database identity comes from the Auth user endpoint", async () => {
  configureAuth(Response.json({ id: userId }));
  assert.equal(await getVerifiedSupabaseUserId("header.payload.signature"), userId);
});

test("a raw UUID cannot establish a Prisma authenticated role", async () => {
  configureAuth(Response.json({ message: "invalid token" }, { status: 401 }));
  await assert.rejects(
    withAuthenticatedUser(userId, async () => "must not run"),
    /Supabase Auth rejected the access token/,
  );
});

test("malformed Auth responses do not establish a database identity", async () => {
  configureAuth(Response.json({ id: "not-a-uuid" }));
  await assert.rejects(getVerifiedSupabaseUserId("header.payload.signature"), /invalid user identity/);
});

test("realtime database identity uses the verified service endpoint variables", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://project.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  let requestedUrl = "";
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return Response.json({ id: userId });
  }) as typeof fetch;
  assert.equal(await getVerifiedSupabaseUserId("header.payload.signature"), userId);
  assert.equal(requestedUrl, "https://project.example.test/auth/v1/user");
});

test("security migration revokes direct profile writes and hides timestamps", async () => {
  const migrationPath = fileURLToPath(new URL("../prisma/migrations/0003_phase1_security_hardening/migration.sql", import.meta.url));
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /REVOKE ALL ON TABLE public\.profiles FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT \(id, username, nickname, avatar_url, avatar_path, games_played, wins\)/);
  assert.match(migration, /DROP POLICY IF EXISTS profile_owner_insert ON public\.profiles/);
  assert.match(migration, /DROP POLICY IF EXISTS profile_owner_update ON public\.profiles/);
  assert.match(migration, /DROP POLICY IF EXISTS profile_avatars_public_read ON storage\.objects/);
  assert.match(migration, /DROP POLICY IF EXISTS profile_avatars_owner_insert/);
  assert.match(migration, /DROP POLICY IF EXISTS profile_avatars_owner_update/);
  assert.match(migration, /DROP POLICY IF EXISTS profile_avatars_owner_delete/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*auth\.uid\(\)/);
  assert.match(migration, /object\.bucket_id = 'profile-avatars'[\s\S]*storage\.foldername\(object\.name\)/);
  assert.match(migration, /profiles_set_updated_at/);
});
