import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const policy = readFileSync(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("privacy policy is a public server-rendered page with no authentication gate", () => {
  assert.match(policy, /export default function PrivacyPolicyPage/);
  assert.doesNotMatch(policy, /getAuthenticatedUserContext|requireSocialContext|redirect\("\/login"\)|use client/);
  assert.match(home, /href="\/privacy"/);
});

test("privacy policy discloses the data practices present in the application", () => {
  for (const disclosure of [
    "openid", "email", "profile", "Supabase Auth", "profile-avatars", "public reads",
    "friend requests", "message text", "Notifications", "validated moves", "Spectator Mode is disabled",
    "service worker", "microphone access", "no audio recording", "retention period",
    "self-service account deletion", "privacy contact",
  ]) {
    assert.ok(policy.toLowerCase().includes(disclosure.toLowerCase()), `missing disclosure: ${disclosure}`);
  }
});
