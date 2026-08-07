/**
 * Behavioral tests for src/run-reconciliation.ts (production module).
 *
 * These import and execute the REAL `resolveRemovableEmails` helper that
 * main.ts::autoRemoveCompletedEmails now delegates to. No mirroring.
 *
 * Run with:
 *   node --experimental-strip-types --test tests/run-reconciliation.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resolveRemovableEmails } from "../src/run-reconciliation.ts";

// Helper to build a detail row concisely.
function row(email, group, status, message = "") {
  return { email, group, status, message };
}

// ── Single-group, all success ───────────────────────────────────────

test("single-group run: all-ok details mark the whole payload removable", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com", "b@x.com"],
    groups: ["grp@x.com"],
    details: [
      row("a@x.com", "grp@x.com", "ok"),
      row("b@x.com", "grp@x.com", "ok"),
    ],
    failedCount: 0,
  });
  assert.deepEqual([...result.removable].sort(), ["a@x.com", "b@x.com"]);
  assert.equal(result.count, 2);
});

// ── Single-group, mixed success/fail ────────────────────────────────

test("single-group run: failed emails are NOT removable", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com", "b@x.com", "c@x.com"],
    groups: ["grp@x.com"],
    details: [
      row("a@x.com", "grp@x.com", "ok"),
      row("b@x.com", "grp@x.com", "fail", "already a member"),
      row("c@x.com", "grp@x.com", "ok"),
    ],
    failedCount: 1,
  });
  assert.deepEqual([...result.removable].sort(), ["a@x.com", "c@x.com"]);
  assert.ok(!result.removable.has("b@x.com"));
});

// ── Multi-group: must succeed in ALL groups to be removable ─────────

test("multi-group run: email ok in one group but not another is NOT removable", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com"],
    groups: ["g1@x.com", "g2@x.com"],
    details: [
      row("a@x.com", "g1@x.com", "ok"),
      row("a@x.com", "g2@x.com", "fail"),
    ],
    failedCount: 1,
  });
  assert.equal(result.count, 0);
  assert.ok(!result.removable.has("a@x.com"));
});

test("multi-group run: email ok in ALL groups is removable", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com"],
    groups: ["g1@x.com", "g2@x.com", "g3@x.com"],
    details: [
      row("a@x.com", "g1@x.com", "ok"),
      row("a@x.com", "g2@x.com", "ok"),
      row("a@x.com", "g3@x.com", "ok"),
    ],
    failedCount: 0,
  });
  assert.deepEqual([...result.removable], ["a@x.com"]);
});

// ── Fallback path: no details ───────────────────────────────────────

test("no details + failedCount 0: whole payload is removable (legacy fallback)", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com", "b@x.com"],
    groups: ["grp@x.com"],
    details: [],
    failedCount: 0,
  });
  assert.deepEqual([...result.removable].sort(), ["a@x.com", "b@x.com"]);
});

test("no details + failedCount > 0: nothing is removable (safe default)", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com", "b@x.com"],
    groups: ["grp@x.com"],
    details: [],
    failedCount: 2,
  });
  assert.equal(result.count, 0);
});

// ── Malformed detail rows are ignored ───────────────────────────────

test("malformed detail rows (bad email/group) are ignored and never count as ok", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com"],
    groups: ["grp@x.com"],
    details: [
      row("a@x.com", "grp@x.com", "ok"),
      row("not-an-email", "grp@x.com", "ok"), // ignored
      row("a@x.com", "", "ok"), // ignored (empty group)
    ],
    failedCount: 0,
  });
  // a@x.com still has exactly one ok for grp@x.com -> removable.
  assert.deepEqual([...result.removable], ["a@x.com"]);
});

// ── Purity: does not mutate inputs ──────────────────────────────────

test("purity: payload, groups, and details arrays are not mutated", () => {
  const payload = ["a@x.com"];
  const groups = ["grp@x.com"];
  const details = [row("a@x.com", "grp@x.com", "ok")];
  const payloadSnapshot = [...payload];
  const groupsSnapshot = [...groups];
  const detailsSnapshot = details.map((d) => ({ ...d }));

  resolveRemovableEmails({
    action: "add",
    payload,
    groups,
    details,
    failedCount: 0,
  });

  assert.deepEqual(payload, payloadSnapshot, "payload must not be mutated");
  assert.deepEqual(groups, groupsSnapshot, "groups must not be mutated");
  assert.deepEqual(details, detailsSnapshot, "details must not be mutated");
});

// ── Empty payload ───────────────────────────────────────────────────

test("empty payload yields an empty removable set", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: [],
    groups: ["grp@x.com"],
    details: [],
    failedCount: 0,
  });
  assert.equal(result.count, 0);
  assert.equal(result.removable.size, 0);
});

// ── Case-insensitive status classification ──────────────────────────

test("status is classified case-insensitively (OK/Ok/ok all count as success)", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com", "b@x.com", "c@x.com"],
    groups: ["grp@x.com"],
    details: [
      row("a@x.com", "grp@x.com", "OK"),
      row("b@x.com", "grp@x.com", "Ok"),
      row("c@x.com", "grp@x.com", "ok"),
    ],
    failedCount: 0,
  });
  assert.equal(result.count, 3);
});

// ── Regression: payload email not present in details is not removed ──

test("regression: payload email with no detail row is NOT removable", () => {
  const result = resolveRemovableEmails({
    action: "add",
    payload: ["a@x.com", "b@x.com"],
    groups: ["grp@x.com"],
    details: [row("a@x.com", "grp@x.com", "ok")], // b@x.com missing
    failedCount: 0,
  });
  assert.deepEqual([...result.removable], ["a@x.com"]);
  assert.ok(!result.removable.has("b@x.com"));
});
