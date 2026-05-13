import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("email list has a dedicated clear button", () => {
  assert.match(mainSource, /id="clear-bulk-input"/);
  assert.match(mainSource, /const clearBulkInputBtn = document\.querySelector<HTMLButtonElement>\("#clear-bulk-input"\)!;/);
  assert.match(styleSource, /\.bulk-input-wrap/);
  assert.match(styleSource, /\.clear-bulk-input-btn/);
});

test("clear button empties only the email list draft", () => {
  assert.match(mainSource, /function clearBulkInput\(\): void/);
  assert.match(mainSource, /bulkInput\.textContent = "";/);
  assert.match(mainSource, /clearBulkInputFromSession\(\);/);
  assert.match(mainSource, /bulkInput\.focus\(\);/);
  assert.match(mainSource, /clearBulkInputBtn\.addEventListener\("click", \(\) => clearBulkInput\(\)\);/);
});

test("queue action buttons use short labels and distinct remove styling", () => {
  assert.match(mainSource, /id="queue-to-add" class="btn solid">Add<\/button>/);
  assert.match(mainSource, /id="queue-to-remove" class="btn remove-action">Remove<\/button>/);
  assert.match(styleSource, /#queue-to-remove/);
  assert.match(styleSource, /border-color: var\(--danger\)/);
  assert.doesNotMatch(mainSource, /Queue to Add/);
  assert.doesNotMatch(mainSource, /Queue to Remove/);
});

test("lane run buttons use compact play run labels aligned left", () => {
  assert.match(mainSource, /id="run-add" class="btn solid lane-run-btn">▶ Run<\/button>/);
  assert.match(mainSource, /id="run-remove" class="btn danger lane-run-btn">▶ Run<\/button>/);
  assert.match(styleSource, /\.lane-head\s*{[^}]*justify-content: flex-start;/s);
  assert.match(styleSource, /\.lane-run-btn\s*{[^}]*margin: 0;/s);
  assert.doesNotMatch(mainSource, /Run Add/);
  assert.doesNotMatch(mainSource, /Run Remove/);
});
