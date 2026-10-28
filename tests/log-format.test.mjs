/**
 * Behavioral tests for src/log-format.ts (production module).
 *
 * These import and execute the REAL `formatRunStdout` helper that
 * main.ts now feeds `result.stdout` through before logging.
 *
 * Run with:
 *   node --experimental-strip-types --test tests/log-format.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { formatRunStdout } from "../src/log-format.ts";

test("drops machine-oriented noise lines", () => {
  const stdout = [
    "Running Add for aswvn_tradeunion@aswhiteglobal.com (1/1)...",
    "Completed Add for 1 group(s).",
    "Success: 6 | Failed: 0",
    "Last exported group: aswvn_tradeunion@aswhiteglobal.com",
    'RESULT_JSON:{"failed":0,"processed":6,"details":[]}'
  ].join("\n");

  const cleaned = formatRunStdout(stdout);
  assert.equal(cleaned, "Running Add for aswvn_tradeunion@aswhiteglobal.com (1/1)...");
});

test("compacts per-email success/fail lines and keeps failure reasons", () => {
  const stdout = [
    "Add success [aswvn_tradeunion@aswhiteglobal.com]: d.leminh@eml.com.au",
    "Add failed [aswvn_tradeunion@aswhiteglobal.com]: quan.tran@premex.com",
    "Error [aswvn_tradeunion@aswhiteglobal.com][quan.tran@premex.com]: Duplicate: email is already a member of this group."
  ].join("\n");

  assert.equal(
    formatRunStdout(stdout),
    [
      "  ✓ d.leminh@eml.com.au",
      "  ✗ quan.tran@premex.com",
      "    ↳ Duplicate: email is already a member of this group."
    ].join("\n")
  );
});

test("shortens the member export path", () => {
  const cleaned = formatRunStdout(
    "Updated members exported to C:\\Users\\ASW_Anguyen\\AppData\\Roaming\\com.aswhite.tradeunion\\final.txt for aswvn_tradeunion@aswhiteglobal.com"
  );
  assert.equal(cleaned, "Members exported for aswvn_tradeunion@aswhiteglobal.com");
});

test("handles Remove actions and empty output", () => {
  assert.equal(
    formatRunStdout("Remove success [g@x.com]: a@b.com\nRemove failed [g@x.com]: c@d.com"),
    "  ✓ a@b.com\n  ✗ c@d.com"
  );
  assert.equal(formatRunStdout(""), "");
  assert.equal(formatRunStdout('RESULT_JSON:{"failed":0}'), "");
});
