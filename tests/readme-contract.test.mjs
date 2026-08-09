/**
 * Contract tests for README accuracy (F-11).
 *
 * Verifies the README does not reference deleted files as actionable commands
 * and documents the current Tauri workflow correctly. Reads the REAL README
 * and the REAL package.json.
 *
 * Run with:
 *   node --test tests/readme-contract.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("README does not instruct users to run deleted Python scripts", () => {
  // These files were removed in F-04. README must not have actionable commands.
  assert.doesNotMatch(readme, /python\s+cli\.py/, "README must not instruct 'python cli.py'");
  assert.doesNotMatch(readme, /python\s+-m\s+unittest/, "README must not instruct 'python -m unittest'");
  assert.doesNotMatch(readme, /from\s+trade_union\s+import/, "README must not instruct 'from trade_union import'");
});

test("README does not instruct users to run deleted PowerShell scripts", () => {
  // single_email_action.ps1 and finalize_group.ps1 were removed in F-05.
  assert.doesNotMatch(
    readme,
    /single_email_action\.ps1(?![\s\S]*removed|[\s\S]*legacy|[\s\S]*superseded)/i,
    "README must not reference single_email_action.ps1 as active"
  );
  assert.doesNotMatch(
    readme,
    /finalize_group\.ps1(?![\s\S]*removed|[\s\S]*legacy|[\s\S]*superseded)/i,
    "README must not reference finalize_group.ps1 as active"
  );
});

test("README documents the current dev command", () => {
  assert.match(readme, /npm\s+run\s+tauri\s+dev/, "README must document 'npm run tauri dev'");
});

test("README documents the current build command", () => {
  assert.match(readme, /npm\s+run\s+tauri\s+build/, "README must document 'npm run tauri build'");
});

test("README documents npm install as the dependency step", () => {
  assert.match(readme, /npm\s+install/, "README must document 'npm install'");
});

test("README does not claim a non-existent npm test script", () => {
  // package.json has no "test" script. README may mention "no npm test" as a
  // clarification, but must not instruct users to run `npm test` as if it
  // works.
  if (!pkg.scripts?.test) {
    // Allow "no npm test" / "npm test script" in advisory context.
    const lines = readme.split("\n");
    for (const line of lines) {
      const hasNpmTest = /\bnpm\s+test\b/.test(line);
      const isAdvisory = /no\s+npm\s+test|is\s+no\s+.*npm\s+test|must\s+not.*npm\s+test/i.test(line);
      if (hasNpmTest && !isAdvisory) {
        assert.fail(`README must not instruct 'npm test' as a working command: ${line.trim()}`);
      }
    }
  }
});

test("README references the current PowerShell production scripts", () => {
  assert.match(readme, /manage_distribution_group\.ps1/, "README should reference manage_distribution_group.ps1");
  assert.match(readme, /common\.ps1/, "README should reference common.ps1 (F-10 shared helper)");
});

test("README mentions Exchange Online modern auth", () => {
  assert.match(readme, /modern auth|MFA/i, "README should document modern auth / MFA");
});

test("README documents the CSP security feature (F-09)", () => {
  assert.match(readme, /CSP|Content Security Policy/i, "README should document CSP");
});

test("README documents the PowerShell timeout (F-06)", () => {
  assert.match(readme, /timeout/i, "README should document the PowerShell timeout");
});

test("README does not reference stale 'Check Group Type' flow", () => {
  // The 'Check Group Type' button and Graph path flow were never implemented
  // in the current UI. README must not describe them as current.
  assert.doesNotMatch(readme, /Check Group Type/i, "README must not reference the non-existent 'Check Group Type' button");
});
