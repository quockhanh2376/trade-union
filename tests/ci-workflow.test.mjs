/**
 * Contract tests for F-17 — CI workflow existence and correctness.
 *
 * Verifies .github/workflows/ci.yml exists, uses correct triggers,
 * minimal permissions, real commands (including clippy), and no Exchange
 * side effects.
 *
 * Run with:
 *   node --test tests/ci-workflow.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wfSource = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("F-17: ci.yml exists and has workflow name", () => {
  assert.match(wfSource, /^name:\s*CI/, "workflow must be named CI");
});

test("F-17: triggers on push to main", () => {
  assert.match(wfSource, /on:[\s\S]*push:[\s\S]*branches:\s*\[main\]/, "must trigger on push to main");
});

test("F-17: triggers on pull_request to main", () => {
  assert.match(wfSource, /pull_request:[\s\S]*branches:\s*\[main\]/, "must trigger on PR to main");
});

test("F-17: permissions are minimal (contents: read only)", () => {
  assert.match(wfSource, /permissions:[\s\S]*contents:\s*read/, "must have contents:read permission");
  assert.doesNotMatch(wfSource, /contents:\s*write/, "must NOT have contents:write");
  assert.doesNotMatch(wfSource, /packages:\s*write/, "must NOT have packages:write");
});

test("F-17: runs on windows-latest", () => {
  assert.match(wfSource, /runs-on:\s*windows-latest/, "must run on windows-latest (Windows-only Tauri app)");
});

test("F-17: uses actions/checkout", () => {
  assert.match(wfSource, /uses:\s*actions\/checkout/, "must checkout");
});

test("F-17: uses setup-node with cache npm", () => {
  assert.match(wfSource, /uses:\s*actions\/setup-node/, "must setup node");
  assert.match(wfSource, /cache:\s*npm/, "must cache npm");
  assert.match(wfSource, /node-version:\s*22/, "must use Node 22");
});

test("F-17: uses dtolnay/rust-toolchain with clippy component", () => {
  assert.match(wfSource, /uses:\s*dtolnay\/rust-toolchain/, "must use dtolnay/rust-toolchain");
  assert.match(wfSource, /components:\s*clippy/, "must install clippy component");
});

test("F-17: runs npm ci", () => {
  assert.match(wfSource, /npm ci/, "must use npm ci for reproducible install");
});

test("F-17: runs npm run build", () => {
  assert.match(wfSource, /npm run build/, "must build frontend");
});

test("F-17: runs node --test (contract tests)", () => {
  assert.match(wfSource, /node --test/, "must run contract tests");
});

test("F-17: runs node --experimental-strip-types --test (behavioral tests)", () => {
  assert.match(wfSource, /node --experimental-strip-types --test/, "must run behavioral tests");
});

test("F-17: runs cargo check", () => {
  assert.match(wfSource, /cargo check --manifest-path/, "must run cargo check");
});

test("F-17: runs cargo clippy with -D warnings", () => {
  assert.match(wfSource, /cargo clippy --manifest-path/, "must run cargo clippy");
  assert.match(wfSource, /-D warnings/, "must enforce -D warnings in clippy");
});

test("F-17: runs cargo test", () => {
  assert.match(wfSource, /cargo test --manifest-path/, "must run cargo test");
});

test("F-17: does NOT call Exchange or PowerShell runtime", () => {
  assert.doesNotMatch(wfSource, /Connect-ExchangeOnline/i, "must not call Exchange");
  assert.doesNotMatch(wfSource, /run_group_action/i, "must not invoke run_group_action");
});

test("F-17: does NOT require secrets", () => {
  assert.doesNotMatch(wfSource, /\$\{\{\s*secrets\./, "must not require secrets");
});
