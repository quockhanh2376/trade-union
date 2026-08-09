/**
 * Contract tests for F-15 — debounced bulk-count update.
 *
 * These assert production source wiring (src/main.ts) for the debounce
 * pattern without wall-clock sleeps or fake-timer dependencies. A regression
 * that removes the debounce, uses a magic number, or lets stale timers
 * overwrite fresh state fails here.
 *
 * Run with:
 *   node --test tests/bulk-count-debounce.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

// ── A. Named debounce constant ──────────────────────────────────────

test("F-15: named debounce constant BULK_COUNT_DEBOUNCE_MS exists", () => {
  assert.match(mainSource, /const BULK_COUNT_DEBOUNCE_MS\s*=/, "must declare BULK_COUNT_DEBOUNCE_MS");
  // No inline magic number in setTimeout call — must use the constant.
  const scheduleBlock = extractFunction(mainSource, "scheduleBulkCount");
  assert.ok(scheduleBlock, "scheduleBulkCount function not found");
  assert.match(scheduleBlock, /BULK_COUNT_DEBOUNCE_MS/, "scheduleBulkCount must use the named constant");
  assert.doesNotMatch(scheduleSourceTimeout(scheduleBlock), /setTimeout\([^,]+,\s*\d+\)/, "must not use inline magic number");
});

// ── B. scheduleBulkCount invalidates previous timer ─────────────────

test("F-15: scheduleBulkCount clears previous timer before setting new", () => {
  const block = extractFunction(mainSource, "scheduleBulkCount");
  assert.ok(block, "scheduleBulkCount not found");
  const clearIdx = block.indexOf("clearTimeout");
  const setIdx = block.indexOf("setTimeout");
  assert.ok(clearIdx !== -1, "scheduleBulkCount must clearTimeout on pending timer");
  assert.ok(setIdx !== -1, "scheduleBulkCount must setTimeout");
  assert.ok(clearIdx < setIdx, "clearTimeout must come before setTimeout");
  // Timer handle must be stored for later invalidation.
  assert.match(block, /bulkCountTimer\s*=/, "scheduleBulkCount must store timer handle");
});

// ── C. input event does NOT call updateBulkCount directly ───────────

test("F-15: input listener uses scheduleBulkCount, not updateBulkCount", () => {
  const block = extractEventListener(mainSource, 'bulkInput.addEventListener("input"');
  assert.ok(block, "bulk input listener not found");
  assert.match(block, /scheduleBulkCount\(\)/, "input listener must call scheduleBulkCount");
  assert.doesNotMatch(block, /updateBulkCount\(\)/, "input listener must NOT call updateBulkCount directly");
});

// ── D. flushBulkCount correctness ───────────────────────────────────

test("F-15: flushBulkCount cancels pending timer and calls update immediately", () => {
  const block = extractFunction(mainSource, "flushBulkCount");
  assert.ok(block, "flushBulkCount not found");
  assert.match(block, /clearTimeout/, "flushBulkCount must clearTimeout");
  assert.match(block, /bulkCountTimer\s*=\s*null/, "flushBulkCount must reset timer handle to null");
  assert.match(block, /updateBulkCount\(\)/, "flushBulkCount must call updateBulkCount immediately");
});

// ── E. Clear invalidates stale timer ────────────────────────────────

test("F-15: clearBulkInput calls flushBulkCount (not updateBulkCount) after clearing", () => {
  const block = extractFunction(mainSource, "clearBulkInput");
  assert.ok(block, "clearBulkInput not found");
  assert.match(block, /flushBulkCount\(\)/, "clearBulkInput must call flushBulkCount to cancel stale timer");
  assert.doesNotMatch(block, /updateBulkCount\(\)/, "clearBulkInput must NOT call updateBulkCount directly");
});

// ── F. Add/Remove freshness ─────────────────────────────────────────

test("F-15: queueFromInput reads current bulkInput.innerText directly", () => {
  const block = extractFunction(mainSource, "queueFromInput");
  assert.ok(block, "queueFromInput not found");
  assert.match(block, /bulkInput\.innerText/, "queueFromInput must read bulkInput.innerText directly");
  // Must flush pending count after restoring content, not leave stale timer.
  assert.match(block, /flushBulkCount\(\)/, "queueFromInput must flushBulkCount after content change");
});

// ── G. Initialization uses flush, not schedule ──────────────────────

test("F-15: initializeQueues uses flushBulkCount for immediate initial count", () => {
  const block = extractFunction(mainSource, "initializeQueues");
  assert.ok(block, "initializeQueues not found");
  assert.match(block, /flushBulkCount\(\)/, "initializeQueues must flushBulkCount for immediate count");
  assert.doesNotMatch(block, /scheduleBulkCount\(\)/, "initializeQueues must NOT use scheduleBulkCount");
});

// ── H. clearQueues also flushes ─────────────────────────────────────

test("F-15: clearQueues flushes count after clearing bulk input", () => {
  const block = extractFunction(mainSource, "clearQueues");
  assert.ok(block, "clearQueues not found");
  assert.match(block, /flushBulkCount\(\)/, "clearQueues must flushBulkCount");
});

// ── Accessibility regression ────────────────────────────────────────

test("F-15: bulk input accessibility attributes preserved", () => {
  assert.match(mainSource, /id="bulk-input"[^>]*role="textbox"/, "bulk input must still have role=textbox");
  assert.match(mainSource, /id="bulk-input"[^>]*aria-multiline="true"/, "bulk input must still have aria-multiline");
  assert.match(mainSource, /id="bulk-input"[^>]*aria-labelledby="bulk-label"/, "bulk input must still have aria-labelledby");
});

// ── No listener multiplication (F-14 preserved) ─────────────────────

test("F-15: render() does not bind listeners (F-14 delegation preserved)", () => {
  const block = extractFunction(mainSource, "render");
  assert.ok(block, "render not found");
  assert.doesNotMatch(block, /addEventListener/, "render must not bind listeners (F-14 delegation)");
  assert.doesNotMatch(block, /bindDynamicEvents/, "render must not call bindDynamicEvents");
});

// ── helpers ─────────────────────────────────────────────────────────

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
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

function extractEventListener(source, prefix) {
  const start = source.indexOf(prefix);
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

function scheduleSourceTimeout(block) {
  const idx = block.indexOf("setTimeout");
  return idx !== -1 ? block.slice(idx, idx + 50) : "";
}
