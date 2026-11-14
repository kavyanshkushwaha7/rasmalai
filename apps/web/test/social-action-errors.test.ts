import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySocialActionFailure, logSocialActionFailure } from "../lib/social-action-errors.js";

test("social failures distinguish authorization, validation, throttling, and infrastructure", () => {
  assert.equal(classifySocialActionFailure({ code: "P2010", meta: { code: "42501", message: "permission denied" } }), "access-denied");
  assert.equal(classifySocialActionFailure({ code: "P2010", meta: { code: "22023", message: "invalid message" } }), "invalid-action");
  assert.equal(classifySocialActionFailure(new Error("rate limit reached")), "rate-limited");
  assert.equal(classifySocialActionFailure({ code: "P1001", message: "database unavailable" }), "temporarily-unavailable");
});

test("social server diagnostics include safe error codes but never raw messages or user content", () => {
  const original = console.error;
  const output: string[] = [];
  console.error = (...values: unknown[]) => output.push(values.map(String).join(" "));
  try {
    logSocialActionFailure("sendDirectMessage", "mutation", {
      code: "P2010",
      meta: { code: "42501", message: "permission denied for function public.rasmalai_send_message; conversation=secret-conversation; body=private-message" },
    });
  } finally {
    console.error = original;
  }
  const line = output.join("\n");
  assert.match(line, /sendDirectMessage/);
  assert.match(line, /42501/);
  assert.match(line, /P2010/);
  assert.match(line, /function_execute_denied:public\.rasmalai_send_message/);
  assert.doesNotMatch(line, /secret-conversation|private-message/);
});
