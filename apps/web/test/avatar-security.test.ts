import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import sharp from "sharp";
import { getOwnedAvatarPathFromUrl, isOwnedAvatarPath, normalizeAvatarImage } from "../lib/avatar-security.js";

const userId = "a21aa111-5d0b-4e12-9a80-82db9ec88f03";

test("avatar uploads are decoded and normalized to WebP", async () => {
  const png = await sharp({ create: { width: 20, height: 10, channels: 3, background: "#61b86b" } }).png().toBuffer();
  const normalized = await normalizeAvatarImage(png);
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 20);
  assert.equal(metadata.height, 10);
});

test("invalid or unsupported file bytes are rejected independent of MIME metadata", async () => {
  await assert.rejects(normalizeAvatarImage(Buffer.from("this is not a PNG")), /Choose a valid PNG, JPG or WebP image\./);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
  await assert.rejects(normalizeAvatarImage(svg), /valid PNG, JPG or WebP/);
});

test("avatar byte size is bounded before decoding", async () => {
  await assert.rejects(normalizeAvatarImage(Buffer.alloc(4 * 1024 * 1024 + 1)), /under 4 MB/);
});

test("only the authenticated user's generated avatar object can be referenced or cleaned up", () => {
  const path = `${userId}/35e6ef92-6e30-4a4d-9da3-bf42a172300f.webp`;
  assert.equal(isOwnedAvatarPath(path, userId), true);
  assert.equal(isOwnedAvatarPath(`${userId}/../other.webp`, userId), false);
  assert.equal(isOwnedAvatarPath(`b21aa111-5d0b-4e12-9a80-82db9ec88f03/${path.split("/")[1]}`, userId), false);
  assert.equal(getOwnedAvatarPathFromUrl(`https://project.example.test/storage/v1/object/public/profile-avatars/${path}`, userId, "https://project.example.test"), path);
  assert.equal(getOwnedAvatarPathFromUrl(`https://other.example.test/storage/v1/object/public/profile-avatars/${path}`, userId, "https://project.example.test"), null);
});

test("the Supabase secret key stays in a server-only module", async () => {
  const admin = await readFile(fileURLToPath(new URL("../lib/supabase/storage-admin.ts", import.meta.url)), "utf8");
  const browserClient = await readFile(fileURLToPath(new URL("../lib/supabase/client.ts", import.meta.url)), "utf8");
  assert.match(admin, /^import "server-only";/);
  assert.match(admin, /process\.env\.SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(browserClient, /SUPABASE_SECRET_KEY|DATABASE_URL|DIRECT_URL/);
});
