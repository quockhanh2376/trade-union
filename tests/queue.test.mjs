/**
 * Behavioral tests for src/queue.ts (production module).
 *
 * These import and execute the REAL production queue functions:
 *   ensureInQueue, removeFromQueue, moveEmail
 * and operate on the REAL exported `state` singleton.
 *
 * Because `state` is a shared module-level mutable singleton, each test
 * resets it in a beforeEach to guarantee isolation.
 *
 * Run with:
 *   node --experimental-strip-types --test tests/queue.test.mjs
 */
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { state, ensureInQueue, removeFromQueue, moveEmail } from "../src/queue.ts";

beforeEach(() => {
  state.add = [];
  state.remove = [];
});

// ── ensureInQueue ───────────────────────────────────────────────────

test("ensureInQueue adds emails to the target queue sorted", () => {
  ensureInQueue("add", ["zeta@x.com", "alpha@x.com"]);
  assert.deepEqual(state.add, ["alpha@x.com", "zeta@x.com"]);
  assert.deepEqual(state.remove, []);
});

test("ensureInQueue deduplicates within the target queue", () => {
  ensureInQueue("add", ["a@x.com", "a@x.com", "b@x.com"]);
  assert.deepEqual(state.add, ["a@x.com", "b@x.com"]);
});

test("ensureInQueue moves an email out of the opposite queue (mutual exclusivity)", () => {
  // Start with carol in remove.
  ensureInQueue("remove", ["carol@x.com"]);
  // Now add carol to add -> she must leave remove.
  ensureInQueue("add", ["carol@x.com"]);
  assert.deepEqual(state.add, ["carol@x.com"]);
  assert.deepEqual(state.remove, [], "email must be removed from the opposite queue");
});

test("ensureInQueue does not touch the opposite queue for unrelated emails", () => {
  ensureInQueue("remove", ["carol@x.com"]);
  ensureInQueue("add", ["alice@x.com"]);
  assert.deepEqual(state.add, ["alice@x.com"]);
  assert.deepEqual(state.remove, ["carol@x.com"]);
});

test("ensureInQueue into remove removes from add", () => {
  ensureInQueue("add", ["alice@x.com", "bob@x.com"]);
  ensureInQueue("remove", ["alice@x.com"]);
  assert.deepEqual(state.add, ["bob@x.com"]);
  assert.deepEqual(state.remove, ["alice@x.com"]);
});

test("ensureInQueue with empty array is a no-op", () => {
  ensureInQueue("add", []);
  assert.deepEqual(state.add, []);
  assert.deepEqual(state.remove, []);
});

// ── removeFromQueue ─────────────────────────────────────────────────

test("removeFromQueue removes only the matching email", () => {
  ensureInQueue("add", ["alice@x.com", "bob@x.com", "carol@x.com"]);
  removeFromQueue("add", "bob@x.com");
  assert.deepEqual(state.add, ["alice@x.com", "carol@x.com"]);
});

test("removeFromQueue is a no-op for a missing email", () => {
  ensureInQueue("add", ["alice@x.com"]);
  removeFromQueue("add", "nobody@x.com");
  assert.deepEqual(state.add, ["alice@x.com"]);
});

test("removeFromQueue does not affect the other queue", () => {
  ensureInQueue("add", ["alice@x.com"]);
  ensureInQueue("remove", ["bob@x.com"]);
  removeFromQueue("add", "alice@x.com");
  assert.deepEqual(state.add, []);
  assert.deepEqual(state.remove, ["bob@x.com"]);
});

// ── moveEmail ───────────────────────────────────────────────────────

test("moveEmail transfers an email from source to target", () => {
  ensureInQueue("add", ["alice@x.com", "bob@x.com"]);
  moveEmail("alice@x.com", "add", "remove");
  assert.deepEqual(state.add, ["bob@x.com"]);
  assert.deepEqual(state.remove, ["alice@x.com"]);
});

test("moveEmail is a no-op when source equals target", () => {
  ensureInQueue("add", ["alice@x.com"]);
  moveEmail("alice@x.com", "add", "add");
  assert.deepEqual(state.add, ["alice@x.com"]);
});

test("moveEmail adds the email to target even when absent from source", () => {
  // Documented production behavior: moveEmail always ensures the email in the
  // target, regardless of whether it was present in source. This means a
  // drop into a lane places the email there even if its drag source didn't
  // actually hold it. Pinning this so a future change is conscious.
  ensureInQueue("add", ["alice@x.com"]);
  moveEmail("nobody@x.com", "add", "remove");
  assert.deepEqual(state.add, ["alice@x.com"]);
  assert.deepEqual(state.remove, ["nobody@x.com"]);
});

// ── Regression cases ────────────────────────────────────────────────

test("Regression: re-adding an email that is in remove pulls it across", () => {
  // This is the core Add/Remove lane UX: dragging/pasting an email that is
  // currently in Remove into Add must remove it from Remove.
  ensureInQueue("remove", ["alice@x.com", "bob@x.com"]);
  ensureInQueue("add", ["alice@x.com"]);
  assert.deepEqual(state.add, ["alice@x.com"]);
  assert.deepEqual(state.remove, ["bob@x.com"]);
});

test("Regression: ensureInQueue preserves normalization (caller lowercases first)", () => {
  // The queue functions trust callers to pass normalized values; they sort
  // but do not re-normalize. We assert the documented contract: values are
  // stored as given (callers normalize before calling). Documenting this so a
  // future change that adds normalization inside queue.ts is a conscious one.
  ensureInQueue("add", ["B@x.com", "A@x.com"]);
  assert.deepEqual(state.add, ["A@x.com", "B@x.com"]);
});
