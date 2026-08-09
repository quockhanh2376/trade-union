import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
);
const mainSource = await readFile(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");

const exchangeScriptNames = [
  "common.ps1",
  "manage_distribution_group.ps1",
  "detect_group_type.ps1"
];

const exchangeScripts = await Promise.all(
  exchangeScriptNames.map(async (fileName) => ({
    fileName,
    source: await readFile(new URL(`../src-tauri/scripts/${fileName}`, import.meta.url), "utf8")
  }))
);

test("installer bundles offline ExchangeOnlineManagement module resources", async () => {
  assert.ok(
    tauriConfig.bundle.resources.includes("vendor/powershell-modules"),
    "PowerShell module vendor directory should be bundled as a Tauri resource"
  );

  const moduleVersions = await readdir(
    new URL("../src-tauri/vendor/powershell-modules/ExchangeOnlineManagement", import.meta.url),
    { withFileTypes: true }
  );

  assert.ok(
    moduleVersions.some((entry) => entry.isDirectory()),
    "ExchangeOnlineManagement should include at least one saved module version"
  );
});

test("backend passes bundled module path into Exchange action scripts", () => {
  assert.match(mainSource, /fn bundled_exchange_modules_path\(app: &AppHandle\) -> Result<PathBuf, String>/);
  assert.match(mainSource, /\.resolve\("vendor\/powershell-modules", BaseDirectory::Resource\)/);
  assert.match(mainSource, /\.arg\("-BundledModulesPath"\)/);
  assert.match(mainSource, /\.arg\(bundled_modules_arg\.as_os_str\(\)\)/);
});

test("backend strips Windows verbatim resource paths before invoking PowerShell", () => {
  assert.match(mainSource, /fn powershell_compatible_path\(path: &Path\) -> PathBuf/);
  assert.match(mainSource, /let script_arg = powershell_compatible_path\(&script\)/);
  assert.match(mainSource, /let queue_file_arg = powershell_compatible_path\(&queue_file\)/);
  assert.match(mainSource, /let output_file_arg = powershell_compatible_path\(&output_file\)/);
  assert.match(mainSource, /let bundled_modules_arg = powershell_compatible_path\(&bundled_modules\)/);
  assert.doesNotMatch(mainSource, /\.arg\(script\.as_os_str\(\)\)/);
  assert.match(mainSource, /\.arg\(bundled_modules_arg\.as_os_str\(\)\)/);
});

test("exchange scripts prefer bundled module path and fallback to online install", () => {
  // F-10: shared helpers live in common.ps1 and are dot-sourced by both scripts.
  const common = exchangeScripts.find((s) => s.fileName === "common.ps1");
  assert.ok(common, "common.ps1 must exist");
  assert.match(common.source, /function Add-BundledExchangeModulePath/, "common.ps1 should define Add-BundledExchangeModulePath");
  assert.match(common.source, /\$pathSeparator = \[System\.IO\.Path\]::PathSeparator/, "common.ps1 should use the platform path separator");
  assert.match(common.source, /-split\s+\[regex\]::Escape\(\$pathSeparator\)/, "common.ps1 should split PSModulePath with the platform separator");
  assert.match(common.source, /-ne \$Path/, "common.ps1 should de-duplicate using the validated module path");
  assert.match(common.source, /\(@\(\$Path\) \+ \$existingPaths\) -join \$pathSeparator/, "common.ps1 should prepend the validated module path");
  assert.doesNotMatch(common.source, /\$env:PSModulePath = "\$BundledModulesPath;/, "common.ps1 should not hard-code the Windows PSModulePath separator");
  assert.match(common.source, /Import-Module ExchangeOnlineManagement -ErrorAction Stop/, "common.ps1 should import ExchangeOnlineManagement");
  assert.match(common.source, /Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber/, "common.ps1 should keep online fallback install");

  // Production scripts must dot-source common.ps1 (no longer duplicate helpers).
  for (const fileName of ["manage_distribution_group.ps1", "detect_group_type.ps1"]) {
    const source = exchangeScripts.find((s) => s.fileName === fileName)?.source;
    assert.ok(source, `${fileName} must exist`);
    assert.match(source, /\. "\$PSScriptRoot\/common\.ps1"/, `${fileName} must dot-source common.ps1`);
    assert.doesNotMatch(source, /function Add-BundledExchangeModulePath/, `${fileName} must not duplicate Add-BundledExchangeModulePath (F-10 dedup)`);
    assert.doesNotMatch(source, /function Ensure-ExchangeModule/, `${fileName} must not duplicate Ensure-ExchangeModule (F-10 dedup)`);
  }
});

test("common.ps1 is bundled as a Tauri resource (F-10)", () => {
  assert.ok(
    tauriConfig.bundle.resources.includes("scripts/common.ps1"),
    "common.ps1 must be in bundle.resources so packaged apps include it"
  );
});
