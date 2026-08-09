/**
 * Contract tests for the Content Security Policy (F-09).
 *
 * These read the REAL production config from src-tauri/tauri.conf.json and
 * assert security properties without hard-coding the entire CSP string (which
 * would be brittle). A regression that weakens CSP (wildcards, unsafe-eval,
 * disabled/null) fails here.
 *
 * Run with:
 *   node --test tests/csp-config.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
);

const csp = tauriConfig.app?.security?.csp;

test("CSP is enabled (not null/undefined)", () => {
  assert.ok(typeof csp === "string" && csp.length > 0, "csp must be a non-empty string, got: " + csp);
});

test("CSP has no wildcard source", () => {
  assert.ok(!/\s\*\s|^\*|\*$/.test(csp), `CSP must not contain wildcard *, got: ${csp}`);
});

test("CSP forbids unsafe-eval in script-src", () => {
  assert.ok(!/'unsafe-eval'/.test(csp), `CSP must not allow 'unsafe-eval', got: ${csp}`);
});

test("CSP forbids broad https: in script-src/style-src", () => {
  assert.ok(!/https:\s/.test(csp), `CSP must not allow broad https:, got: ${csp}`);
});

test("CSP sets default-src to 'self'", () => {
  assert.match(csp, /default-src 'self'/, `default-src must be 'self', got: ${csp}`);
});

test("CSP sets object-src to 'none'", () => {
  assert.match(csp, /object-src 'none'/, `object-src must be 'none', got: ${csp}`);
});

test("CSP sets base-uri to 'none' (no <base> tag is used)", () => {
  assert.match(csp, /base-uri 'none'/, `base-uri must be 'none', got: ${csp}`);
});

test("CSP sets frame-ancestors to 'none'", () => {
  assert.match(csp, /frame-ancestors 'none'/, `frame-ancestors must be 'none', got: ${csp}`);
});

test("CSP does NOT allow data: in img-src (no <img>/url()/data: used)", () => {
  const imgSrc = (csp.match(/img-src ([^;]+)/) || [])[1] ?? "";
  assert.ok(!/data:/.test(imgSrc), `img-src must not allow data:, got: ${imgSrc}`);
});

test("CSP allows Tauri IPC connect-src (ipc: + ipc.localhost)", () => {
  // Tauri v2 IPC requires ipc: scheme + http://ipc.localhost on Windows.
  assert.match(csp, /connect-src [^;]*ipc:/, `connect-src must allow ipc: for Tauri IPC, got: ${csp}`);
  assert.match(csp, /connect-src [^;]*ipc\.localhost/, `connect-src must allow ipc.localhost for Tauri IPC, got: ${csp}`);
});

test("CSP does NOT include 'unsafe-inline' in script-src", () => {
  // Inline scripts are forbidden; only inline style attributes are allowed.
  const scriptSrc = (csp.match(/script-src ([^;]+)/) || [])[1] ?? "";
  assert.ok(!/'unsafe-inline'/.test(scriptSrc), `script-src must not allow 'unsafe-inline', got: ${scriptSrc}`);
});
