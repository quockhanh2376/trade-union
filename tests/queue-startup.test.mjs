/**
 * Behavioral tests for F-02 (queue-wipe-on-startup).
 *
 * These tests IMPORT AND RUN the production helper `resolveInitialQueues`
 * from src/queue-startup.ts (via Node v22's --experimental-strip-types).
 * They do NOT mirror or reimplement the startup logic. A regression in the
 * production helper will fail these tests directly.
 *
 * Run with:
 *   node --experimental-strip-types --test tests/queue-startup.test.mjs
 *
 * The accompanying wiring-contract tests assert that src/main.ts actually
 * calls this helper at startup (so the helper can't be dead code) and that
 * startup never calls the persist function.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveInitialQueues } from "../src/queue-startup.ts";

// ── Behavioral tests against the PRODUCTION helper ─────────────────
// The helper's contract is load-only: it has no persist dependency in its
// signature, so it is structurally incapable of writing. The behavioral
// tests therefore focus on: data fidelity, failure safety, idempotency,
// and the copy-vs-alias guarantee that protects seed data.

// Case A — persisted queue present: items survive verbatim.
test("Case A: persisted queue items are preserved", async () => {
  const persisted = {
    add: ["alice@example.com", "bob@example.com"],
    remove: ["carol@example.com"],
  };
  let loadCalls = 0;

  const result = await resolveInitialQueues({
    loadPersistedQueues: async () => { loadCalls++; return persisted; },
  });

  assert.equal(loadCalls, 1, "loader is called exactly once");
  assert.equal(result.loaded, true);
  assert.deepEqual(result.queues.add, persisted.add);
  assert.deepEqual(result.queues.remove, persisted.remove);
});

// Case B — no persisted state: valid empty default, no crash.
test("Case B: first-run with empty persisted state yields a valid default", async () => {
  const result = await resolveInitialQueues({
    loadPersistedQueues: async () => ({ add: [], remove: [] }),
  });

  assert.equal(result.loaded, true);
  assert.ok(Array.isArray(result.queues.add));
  assert.ok(Array.isArray(result.queues.remove));
  assert.equal(result.queues.add.length, 0);
  assert.equal(result.queues.remove.length, 0);
});

// Case C — loader throws: empty default returned, onError called, does not throw.
test("Case C: a failed load returns empty default and reports the error without throwing", async () => {
  let errorReported = null;
  const loadError = new Error("backend unavailable");

  const result = await resolveInitialQueues({
    loadPersistedQueues: async () => { throw loadError; },
    onError: (msg) => { errorReported = msg; },
  });

  assert.equal(result.loaded, false, "loaded flag is false on failure");
  assert.deepEqual(result.queues.add, []);
  assert.deepEqual(result.queues.remove, []);
  assert.ok(errorReported, "onError is invoked on failure");
  assert.match(errorReported, /Cannot load saved queues/);
});

// Case D — idempotency: calling startup twice with the same seed yields the
// same state, no duplicates, no mutation of the seed.
test("Case D: repeated startup with the same seed is idempotent", async () => {
  const seed = {
    add: ["alice@example.com", "bob@example.com"],
    remove: ["carol@example.com"],
  };
  const frozenSeed = Object.freeze({
    add: Object.freeze([...seed.add]),
    remove: Object.freeze([...seed.remove]),
  });

  const r1 = await resolveInitialQueues({ loadPersistedQueues: async () => frozenSeed });
  const r2 = await resolveInitialQueues({ loadPersistedQueues: async () => frozenSeed });

  assert.deepEqual(r1.queues, r2.queues);
  assert.deepEqual(r1.queues.add, seed.add);
  assert.deepEqual(r1.queues.remove, seed.remove);
});

// Mutation guard: the helper returns copies, so mutating the result does not
// corrupt the seed. This catches a future "state.add = seed.add" aliasing bug.
test("Mutation guard: result arrays are copies, not aliases of seed", async () => {
  const seed = { add: ["alice@example.com"], remove: [] };
  const result = await resolveInitialQueues({ loadPersistedQueues: async () => seed });

  result.queues.add.push("injected@example.com");
  assert.deepEqual(seed.add, ["alice@example.com"], "seed must not be mutated by caller");
  assert.notEqual(result.queues.add, seed.add, "result array must not alias the seed array");
});

// ── Wiring contract: src/main.ts must call the production helper ───

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

test("Wiring: src/main.ts calls resolveInitialQueues during startup", () => {
  // The old buggy function name must be gone.
  assert.doesNotMatch(mainSource, /function initializeEmptyQueues\b/);
  assert.doesNotMatch(mainSource, /void initializeEmptyQueues\(\)/);
  // The new function and the production helper must both be wired.
  assert.match(mainSource, /import \{ resolveInitialQueues \} from "\.\/queue-startup"/);
  assert.match(mainSource, /async function initializeQueues\(\): Promise<void>/);
  assert.match(mainSource, /void initializeQueues\(\);/);
  assert.match(mainSource, /await resolveInitialQueues\(/);
  assert.match(mainSource, /loadPersistedQueues: \(\) => invoke<SeedEmails>\("load_seed_emails"\)/);
});

test("Wiring: startup does NOT call persistQueues (no wipe-on-start)", () => {
  const fnBlock = extractFunction(mainSource, "initializeQueues");
  assert.ok(fnBlock, "initializeQueues function body not found");
  assert.doesNotMatch(fnBlock, /persistQueues\(\)/);
});

// ── Field-mapping: add/remove must not be swapped ──────────────────

test("Mapping: add field stays in add, remove stays in remove", async () => {
  const seed = {
    add: ["add-only@example.com"],
    remove: ["remove-only@example.com"],
  };
  const result = await resolveInitialQueues({ loadPersistedQueues: async () => seed });

  assert.deepEqual(result.queues.add, ["add-only@example.com"]);
  assert.deepEqual(result.queues.remove, ["remove-only@example.com"]);
  // Explicit anti-swap check.
  assert.ok(!result.queues.add.includes("remove-only@example.com"));
  assert.ok(!result.queues.remove.includes("add-only@example.com"));
});

// ── Async ordering: helper awaits loader before resolving ──────────
// If the helper forgot `await`, it would resolve before the loader's
// microtask runs, and `loaded`/queues would be wrong. We prove ordering by
// making the loader defer and checking the helper has not resolved early.

test("Async ordering: helper awaits the loader before resolving", async () => {
  let loaderStarted = false;
  let resolveLoader;
  const loaderPromise = new Promise((resolve) => { resolveLoader = resolve; });

  const helperPromise = resolveInitialQueues({
    loadPersistedQueues: () => {
      loaderStarted = true;
      return loaderPromise;
    },
  });

  // Give the microtask queue a chance to run. The helper must still be pending
  // because the loader has not resolved.
  await Promise.resolve();
  await Promise.resolve();
  let resolvedEarly = false;
  helperPromise.then(() => { resolvedEarly = true; });
  await Promise.resolve();

  assert.equal(loaderStarted, true, "loader is invoked synchronously");
  assert.equal(resolvedEarly, false, "helper must NOT resolve before the loader does");

  // Now complete the loader; the helper should resolve with the loaded data.
  resolveLoader({ add: ["late@example.com"], remove: [] });
  const result = await helperPromise;
  assert.equal(result.loaded, true);
  assert.deepEqual(result.queues.add, ["late@example.com"]);
});

// ── Load-failure mutation guard in main.ts (wiring contract) ────────
// These contract tests verify that EVERY queue-mutating entry point in
// src/main.ts guards on `loadFailed`. Because main.ts needs the DOM/Tauri
// at runtime, we assert the guard text at the head of each handler rather
// than executing the handler. A future regression that removes a guard
// will fail here.

test("Guard: delete-btn handler checks loadFailed before mutating", () => {
  const block = extractFunction(mainSource, "bindDynamicEvents");
  assert.ok(block, "bindDynamicEvents body not found");
  // The delete click handler must bail out when loadFailed is true.
  assert.match(block, /button\.addEventListener\("click", async \(\) => \{[\s\S]*?if \(loadFailed\) return;/);
});

test("Guard: drop handler checks loadFailed before mutating", () => {
  const block = extractFunction(mainSource, "wireDropZone");
  assert.ok(block, "wireDropZone body not found");
  assert.match(block, /zone\.addEventListener\("drop", async \(event\) => \{[\s\S]*?if \(loadFailed\) return;/);
});

test("Guard: runAction checks loadFailed at entry", () => {
  const block = extractFunction(mainSource, "runAction");
  assert.ok(block, "runAction body not found");
  // The guard must appear before the first state read (payload snapshot).
  const guardIdx = block.indexOf("if (loadFailed)");
  const payloadIdx = block.indexOf("const payload =");
  assert.ok(guardIdx !== -1, "runAction must contain a loadFailed guard");
  assert.ok(payloadIdx !== -1, "runAction must snapshot payload");
  assert.ok(guardIdx < payloadIdx, "loadFailed guard must precede payload snapshot");
});

test("Guard: setBusy keeps controls locked when loadFailed is true", () => {
  const block = extractFunction(mainSource, "setBusy");
  assert.ok(block, "setBusy body not found");
  // The effective disabled state must OR-in loadFailed so setBusy(false)
  // does not unlock the UI after a failed load.
  assert.match(block, /const effectivelyBusy = value \|\| loadFailed;/);
  assert.match(block, /el\.disabled = effectivelyBusy;/);
});

test("Guard: loadFailed is only set from the startup result, and locks bulk input", () => {
  const initBlock = extractFunction(mainSource, "initializeQueues");
  assert.ok(initBlock, "initializeQueues body not found");
  // loadFailed mirrors the resolver's `loaded` flag (inverted).
  assert.match(initBlock, /loadFailed = !result\.loaded;/);
  // When load fails, bulk input is made non-editable and a warning is logged.
  assert.match(initBlock, /if \(loadFailed\) \{[\s\S]*?contentEditable = "false"/);
});

// ── helpers ─────────────────────────────────────────────────────────

/** Extract the body of a function (sync or async) from TypeScript source by brace walking. */
function extractFunction(source, name) {
  // Match either "async function name(" or "function name(".
  const asyncIdx = source.indexOf(`async function ${name}(`);
  const syncIdx = source.indexOf(`function ${name}(`);
  const start = asyncIdx !== -1 ? asyncIdx : syncIdx;
  if (start === -1) return null;
  let depth = 0;
  let entered = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") { depth++; entered = true; }
    else if (ch === "}") { depth--; if (entered && depth === 0) return source.slice(start, i + 1); }
  }
  return null;
}
