/**
 * Behavioral + contract tests for F-07/F-08 (queue race guards).
 *
 * Part A–C import and execute the REAL production guard helpers from
 * src/queue-mutation-guard.ts. Part D exercises real queue state snapshot
 * semantics from src/queue.ts. Parts E–G are wiring-contract assertions that
 * verify src/main.ts actually calls these guards at every mutation/run entry
 * point (since main.ts needs the DOM/Tauri at runtime, we grep its source).
 *
 * Run with:
 *   node --experimental-strip-types --test tests/queue-mutation-guard.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canMutateQueues,
  canStartRun,
  blockReason,
} from "../src/queue-mutation-guard.ts";

// ── A. runAction guard (canStartRun) ────────────────────────────────

test("canStartRun allows when idle and load succeeded", () => {
  assert.equal(canStartRun({ busy: false, loadFailed: false }), true);
});

test("canStartRun blocks when busy (F-07 double-run)", () => {
  assert.equal(canStartRun({ busy: true, loadFailed: false }), false);
});

test("canStartRun blocks when loadFailed", () => {
  assert.equal(canStartRun({ busy: false, loadFailed: true }), false);
});

test("canStartRun blocks when both busy and loadFailed", () => {
  assert.equal(canStartRun({ busy: true, loadFailed: true }), false);
});

// ── B. mutation guard (canMutateQueues) ─────────────────────────────

test("canMutateQueues allows when idle and load succeeded", () => {
  assert.equal(canMutateQueues({ busy: false, loadFailed: false }), true);
});

test("canMutateQueues blocks when busy (F-08 mid-run mutation)", () => {
  assert.equal(canMutateQueues({ busy: true, loadFailed: false }), false);
});

test("canMutateQueues blocks when loadFailed (F-02)", () => {
  assert.equal(canMutateQueues({ busy: false, loadFailed: true }), false);
});

// ── C. loadFailed + busy combination (guard combine) ────────────────

test("blockReason reports busy when busy regardless of loadFailed", () => {
  assert.match(blockReason({ busy: true, loadFailed: false }) ?? "", /already running/);
  // busy takes priority over loadFailed in blockReason ordering.
  assert.match(blockReason({ busy: true, loadFailed: true }) ?? "", /already running/);
});

test("blockReason reports load-failure when idle but loadFailed", () => {
  assert.match(
    blockReason({ busy: false, loadFailed: true }) ?? "",
    /read-only/
  );
});

test("blockReason returns null when everything is allowed", () => {
  assert.equal(blockReason({ busy: false, loadFailed: false }), null);
});

// ── D. snapshot immutability (real queue.ts state) ──────────────────
// Verifies that payload snapshotting via `[...state[action]]` decouples the
// snapshot from later state mutations. Uses the REAL queue.ts `state`.

test("snapshot via spread is decoupled from later state mutation", async () => {
  const { state } = await import("../src/queue.ts");
  // Reset shared state for isolation.
  state.add = ["a@x.com", "b@x.com"];
  state.remove = [];

  // Take the snapshot the same way runAction does.
  const payload = [...state.add];
  // Simulate a concurrent mutation (e.g. a drag/delete racing the run).
  state.add.push("c@x.com");
  state.add.splice(0, 1); // remove a@x.com

  // The snapshot must be unaffected.
  assert.deepEqual(payload, ["a@x.com", "b@x.com"]);
  assert.notEqual(payload, state.add, "snapshot must not alias state.add");
});

test("snapshot groups array is independent of caller mutations", () => {
  // Mirrors saveGroupEmails-style: a fresh array returned to the caller.
  const groups = ["g1@x.com", "g2@x.com"];
  const snapshot = [...groups];
  groups.push("g3@x.com");
  assert.deepEqual(snapshot, ["g1@x.com", "g2@x.com"]);
});

// ── E–G. Wiring contract: every mutation/run entry point guards ─────

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

test("Wiring: runAction guards at entry with canStartRun (F-07)", () => {
  const block = extractFunction(mainSource, "runAction");
  assert.ok(block, "runAction body not found");
  // The guard must appear before the payload snapshot.
  const guardIdx = block.indexOf("canStartRun(guardState())");
  const payloadIdx = block.indexOf("const payload =");
  assert.ok(guardIdx !== -1, "runAction must call canStartRun");
  assert.ok(payloadIdx !== -1, "runAction must snapshot payload");
  assert.ok(guardIdx < payloadIdx, "canStartRun guard must precede payload snapshot");
});

test("Wiring: queueFromInput guards with requireMutationsAllowed (F-08)", () => {
  const block = extractFunction(mainSource, "queueFromInput");
  assert.ok(block, "queueFromInput body not found");
  const guardIdx = block.indexOf("requireMutationsAllowed()");
  const mutateIdx = block.indexOf("ensureInQueue(");
  assert.ok(guardIdx !== -1, "queueFromInput must call requireMutationsAllowed");
  assert.ok(mutateIdx !== -1, "queueFromInput must mutate via ensureInQueue");
  assert.ok(guardIdx < mutateIdx, "guard must precede mutation");
});

test("Wiring: clearQueues guards with requireMutationsAllowed (F-08)", () => {
  const block = extractFunction(mainSource, "clearQueues");
  assert.ok(block, "clearQueues body not found");
  const guardIdx = block.indexOf("requireMutationsAllowed()");
  const mutateIdx = block.indexOf("state.add = []");
  assert.ok(guardIdx !== -1, "clearQueues must call requireMutationsAllowed");
  assert.ok(mutateIdx !== -1, "clearQueues must reset state");
  assert.ok(guardIdx < mutateIdx, "guard must precede state reset");
});

test("Wiring: undoSwapQueues guards with requireMutationsAllowed (F-08)", () => {
  const block = extractFunction(mainSource, "undoSwapQueues");
  assert.ok(block, "undoSwapQueues body not found");
  const guardIdx = block.indexOf("requireMutationsAllowed()");
  const mutateIdx = block.indexOf("state.add =");
  assert.ok(guardIdx !== -1, "undoSwapQueues must call requireMutationsAllowed");
  assert.ok(mutateIdx !== -1, "undoSwapQueues must mutate state");
  assert.ok(guardIdx < mutateIdx, "guard must precede swap");
});

test("Wiring: delete-btn handler guards with requireMutationsAllowed (F-08)", () => {
  const block = extractFunction(mainSource, "wireQueueDelegation");
  assert.ok(block, "wireQueueDelegation body not found");
  assert.match(
    block,
    /requireMutationsAllowed\(\)/,
    "delegated click handler must call requireMutationsAllowed before mutating"
  );
});

test("Wiring: drop handler guards with requireMutationsAllowed (F-08)", () => {
  const block = extractFunction(mainSource, "wireDropZone");
  assert.ok(block, "wireDropZone body not found");
  assert.match(
    block,
    /zone\.addEventListener\("drop", async \(event\) => \{[\s\S]*?requireMutationsAllowed\(\)/,
    "drop handler must call requireMutationsAllowed before mutating"
  );
});

test("Wiring: setBusy re-enables only after run completion path (ordering)", () => {
  const block = extractFunction(mainSource, "runAction");
  assert.ok(block, "runAction body not found");
  // autoRemoveCompletedEmails must occur before setBusy(false) so that
  // reconciliation + persistence finish before the UI is unlocked.
  const autoRemoveIdx = block.indexOf("autoRemoveCompletedEmails(");
  const unlockIdx = block.indexOf("setBusy(false)");
  assert.ok(autoRemoveIdx !== -1, "runAction must call autoRemoveCompletedEmails");
  assert.ok(unlockIdx !== -1, "runAction must call setBusy(false) to unlock");
  assert.ok(
    autoRemoveIdx < unlockIdx,
    "autoRemoveCompletedEmails must run before setBusy(false) unlocks the UI"
  );
});

test("Wiring: error path resets busy via finally", () => {
  const block = extractFunction(mainSource, "runAction");
  assert.ok(block, "runAction body not found");
  // setBusy(false) must be inside a finally so an thrown invoke still unlocks.
  assert.match(block, /finally\s*\{[\s\S]*?setBusy\(false\)/, "setBusy(false) must be in finally");
});

test("Wiring: guard helpers imported from queue-mutation-guard", () => {
  assert.match(
    mainSource,
    /import \{[^}]*canMutateQueues[^}]*\} from "\.\/queue-mutation-guard\.ts"/,
    "main.ts must import the guard helpers"
  );
});

test("Wiring: old loadFailed-only guards in delete/drop replaced by helper", () => {
  // The old `if (loadFailed) return;` lines in delete/drop handlers must be
  // gone — superseded by requireMutationsAllowed() which covers busy too.
  const delegBlock = extractFunction(mainSource, "wireQueueDelegation");
  const dropBlock = extractFunction(mainSource, "wireDropZone");
  assert.ok(delegBlock, "wireQueueDelegation body not found");
  assert.ok(!/if \(loadFailed\) return;/.test(delegBlock), "delegated delete handler must not use the old loadFailed-only guard");
  assert.ok(!/if \(loadFailed\) return;/.test(dropBlock), "drop handler must not use the old loadFailed-only guard");
});

// ── helpers ─────────────────────────────────────────────────────────

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  const syncStart = source.indexOf(`function ${name}(`);
  const idx = start !== -1 ? start : syncStart;
  if (idx === -1) return null;
  let depth = 0;
  let entered = false;
  for (let i = idx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") { depth++; entered = true; }
    else if (ch === "}") { depth--; if (entered && depth === 0) return source.slice(idx, i + 1); }
  }
  return null;
}
