import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
);
const mainSource = await readFile(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");

const exchangeScriptNames = [
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
  for (const { fileName, source } of exchangeScripts) {
    assert.match(source, /\[string\]\$BundledModulesPath/, `${fileName} should accept a bundled module path`);
    assert.match(source, /function Add-BundledExchangeModulePath/, `${fileName} should prepend bundled module path`);
    assert.match(source, /\$pathSeparator = \[System\.IO\.Path\]::PathSeparator/, `${fileName} should use the platform path separator`);
    assert.match(source, /-split\s+\[regex\]::Escape\(\$pathSeparator\)/, `${fileName} should split PSModulePath with the platform separator`);
    assert.match(source, /-ne \$Path/, `${fileName} should de-duplicate using the validated module path`);
    assert.match(source, /\(@\(\$Path\) \+ \$existingPaths\) -join \$pathSeparator/, `${fileName} should prepend the validated module path`);
    assert.doesNotMatch(source, /\$env:PSModulePath = "\$BundledModulesPath;/, `${fileName} should not hard-code the Windows PSModulePath separator`);
    assert.match(source, /Import-Module ExchangeOnlineManagement -ErrorAction Stop/, `${fileName} should import ExchangeOnlineManagement`);
    assert.match(source, /Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber/, `${fileName} should keep online fallback install`);
  }
});
