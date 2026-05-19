import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
);

const installerHookSource = await readFile(
  new URL("../src-tauri/installer-hooks/clean-install.nsh", import.meta.url),
  "utf8"
).catch(() => "");

test("windows installers keep one upgrade identity across releases", () => {
  assert.equal(
    tauriConfig.bundle.windows.wix?.upgradeCode,
    "142d4337-ebfa-5a2e-a5f7-33592dce26d6"
  );
});

test("nsis installer removes previous app installs before copying the new version", () => {
  assert.equal(
    tauriConfig.bundle.windows.nsis?.installerHooks,
    "installer-hooks/clean-install.nsh"
  );
  assert.match(installerHookSource, /!macro NSIS_HOOK_PREINSTALL/);
  assert.match(installerHookSource, /DisplayName/);
  assert.match(installerHookSource, /Trade Union Group Manager/);
  assert.match(installerHookSource, /QuietUninstallString/);
  assert.match(installerHookSource, /UninstallString/);
  assert.match(installerHookSource, /ExecWait/);
});

test("clean install hook does not delete user app data", () => {
  assert.doesNotMatch(installerHookSource, /RMDir\s+\/r\s+["']?\$APPDATA/i);
  assert.doesNotMatch(installerHookSource, /RMDir\s+\/r\s+["']?\$LOCALAPPDATA/i);
  assert.doesNotMatch(installerHookSource, /com\.aswhite\.tradeunion/i);
});
