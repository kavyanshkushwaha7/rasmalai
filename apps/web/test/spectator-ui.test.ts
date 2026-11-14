import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleUnreadNotificationCount } from "../lib/spectator-ui.js";

test("disabled spectator invitations are excluded from visible notification badges", () => {
  assert.equal(visibleUnreadNotificationCount(7, 2, false), 5);
  assert.equal(visibleUnreadNotificationCount(2, 4, false), 0);
  assert.equal(visibleUnreadNotificationCount(7, 2, true), 7);
});
