/**
 * Contract tests for F-18 — dead CSS removal.
 *
 * Verifies that the 4 dead selectors identified in F-18 have been removed,
 * and that critical accessibility/dynamic CSS is preserved.
 *
 * Run with:
 *   node --test tests/css-contract.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssSource = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

// ── Dead CSS selectors removed (F-18) ───────────────────────────────

test("F-18: .composer textarea rule removed (element does not exist)", () => {
  assert.doesNotMatch(cssSource, /\.composer\s+textarea\s*\{/, "must not have .composer textarea rule");
});

test("F-18: .btn.wide rule removed (class never used)", () => {
  assert.doesNotMatch(cssSource, /\.btn\.wide\s*\{/, "must not have .btn.wide rule");
});

test("F-18: .lane-hint rule removed (class never used)", () => {
  assert.doesNotMatch(cssSource, /\.lane-hint\s*\{/, "must not have .lane-hint rule");
});

test("F-18: .lane-head h2 rule removed (no <h2> in lane-head)", () => {
  assert.doesNotMatch(cssSource, /\.lane-head\s+h2\s*\{/, "must not have .lane-head h2 rule");
});

// ── Critical CSS preserved (F-13/F-14/F-15 guards) ─────────────────

test("F-18: .sr-only class preserved (F-13 accessibility)", () => {
  assert.match(cssSource, /\.sr-only\s*\{/, ".sr-only must be preserved");
});

test("F-18: .email-item:focus-visible preserved (F-13/F-14)", () => {
  assert.match(cssSource, /\.email-item:focus-visible/, "email-item focus-visible must be preserved");
});

test("F-18: .btn:focus-visible preserved (F-13)", () => {
  assert.match(cssSource, /\.btn:focus-visible/, "button focus-visible must be preserved");
});

test("F-18: .bulk-editable:focus-visible preserved (F-13)", () => {
  assert.match(cssSource, /\.bulk-editable:focus-visible/, "bulk-editable focus-visible must be preserved");
});

test("F-18: .drop-hover preserved (drag/drop state)", () => {
  assert.match(cssSource, /\.drop-list\.drop-hover/, "drop-hover state must be preserved");
});

test("F-18: .hidden preserved (modal toggle)", () => {
  assert.match(cssSource, /\.hidden\s*\{/, ".hidden must be preserved for modal toggle");
});
