import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
const tauriSource = await readFile(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");

test("tab navigation structure exists with both tabs", () => {
  assert.match(mainSource, /id="tab-groups-btn"/);
  assert.match(mainSource, /id="tab-password-btn"/);
  assert.match(mainSource, /Distribution Groups/);
  assert.match(mainSource, /Change Password/);
  assert.match(mainSource, /id="pane-groups"/);
  assert.match(mainSource, /id="pane-password"/);
  assert.match(styleSource, /\.tab-nav/);
  assert.match(styleSource, /\.tab-btn/);
});

test("password form controls exist with proper IDs and attributes", () => {
  assert.match(mainSource, /Target Email:/);
  assert.match(mainSource, /id="target-upn"/);
  assert.match(mainSource, /id="save-target-upn-btn"/);
  assert.match(mainSource, /id="new-password"/);
  assert.match(mainSource, /id="toggle-pwd-btn"/);
  assert.match(mainSource, /id="force-change-pwd"/);
  assert.match(mainSource, /id="btn-change-password"/);
  assert.match(mainSource, /id="pwd-status-badge"/);
  assert.match(styleSource, /\.password-submit-btn\.is-loading/);
});

test("tab switching and password change handlers are implemented", () => {
  assert.match(mainSource, /function switchTab\(tab: "groups" \| "password"\): void/);
  assert.match(mainSource, /function togglePasswordVisibility\(\): void/);
  assert.match(mainSource, /async function handlePasswordChange\(\): Promise<void>/);
  assert.match(mainSource, /invoke<PasswordChangeResult>\("change_user_password"/);
});

test("backend implements change_user_password command and registers it", () => {
  assert.match(tauriSource, /async fn change_user_password\(/);
  assert.match(tauriSource, /change_user_password/);
  assert.match(tauriSource, /struct PasswordChangeResult/);
});
