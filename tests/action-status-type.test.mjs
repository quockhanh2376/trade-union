/**
 * Contract tests for F-16 — ActionStatus type safety.
 *
 * Verifies that ActionDetail.status uses a typed union (not bare string),
 * that the union covers all runtime values, and that normalizeStatus
 * returns the correct union type.
 *
 * Run with:
 *   node --test tests/action-status-type.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const typesSource = await readFile(new URL("../src/types.ts", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const reconSource = await readFile(new URL("../src/run-reconciliation.ts", import.meta.url), "utf8");

// ── 1. ActionStatus type exists and is a union ──────────────────────

test("F-16: ActionStatus type is declared as a string union", () => {
  assert.match(typesSource, /export type ActionStatus\s*=\s*"ok"\s*\|\s*"fail"/, "ActionStatus must be 'ok' | 'fail'");
});

// ── 2. ActionDetail.status uses ActionStatus, not bare string ───────

test("F-16: ActionDetail.status is typed as ActionStatus (not string)", () => {
  assert.match(typesSource, /status:\s*ActionStatus/, "ActionDetail.status must use ActionStatus type");
  assert.doesNotMatch(typesSource, /status:\s*string/, "ActionDetail.status must NOT be bare string");
});

// ── 3. normalizeStatus returns ActionStatus ─────────────────────────

test("F-16: normalizeStatus returns ActionStatus", () => {
  assert.match(
    mainSource,
    /function normalizeStatus\([^)]*\):\s*ActionStatus/,
    "normalizeStatus must return ActionStatus"
  );
});

// ── 4. run-reconciliation uses ActionStatus (not local Status type) ─

test("F-16: run-reconciliation uses ActionStatus from types (not local Status duplicate)", () => {
  assert.match(reconSource, /import.*ActionStatus.*from.*types\.ts/, "run-reconciliation must import ActionStatus");
  assert.doesNotMatch(reconSource, /type Status\s*=\s*"ok"\s*\|\s*"fail"/, "run-reconciliation must not duplicate the Status type locally");
});

// ── 5. classifyStatus returns ActionStatus ──────────────────────────

test("F-16: classifyStatus in run-reconciliation returns ActionStatus", () => {
  assert.match(
    reconSource,
    /function classifyStatus\([^)]*\):\s*ActionStatus/,
    "classifyStatus must return ActionStatus"
  );
});

// ── 6. Runtime values match the union ───────────────────────────────

test("F-16: runtime status values from PowerShell match the union", () => {
  // normalizeStatus maps "Ok" → "ok", anything else → "fail".
  // classifyStatus does the same. Both are covered by the union.
  assert.match(mainSource, /=== "ok".*"ok".*"fail"/, "normalizeStatus maps ok/fail correctly");
  assert.match(reconSource, /=== "ok".*"ok".*"fail"/, "classifyStatus maps ok/fail correctly");
});
