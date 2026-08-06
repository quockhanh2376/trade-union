import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("email list shows a live total count in a circle badge", () => {
  assert.match(mainSource, /id="bulk-count" class="bulk-count-circle is-empty"/);
  assert.match(mainSource, /const bulkCount = document\.querySelector<HTMLSpanElement>\("#bulk-count"\)!;/);
  assert.match(mainSource, /function updateBulkCount\(\): void/);
  assert.match(mainSource, /const count = parseEmails\(bulkInput\.innerText\)\.length;/);
  assert.match(mainSource, /bulkCount\.classList\.toggle\("is-empty", count === 0\);/);
  assert.match(styleSource, /\.bulk-count-circle/);
  assert.match(styleSource, /\.bulk-count-circle\.is-empty/);
});

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

test("lane run buttons are disabled when their queue is empty", () => {
  assert.match(mainSource, /let isBusy = false;/);
  assert.match(mainSource, /function updateRunButtonStates\(busy = isBusy\): void/);
  assert.match(mainSource, /runAddBtn\.disabled = busy \|\| state\.add\.length === 0;/);
  assert.match(mainSource, /runRemoveBtn\.disabled = busy \|\| state\.remove\.length === 0;/);
  assert.match(mainSource, /function render\(\): void\s*{[^}]*updateRunButtonStates\(\);/s);
  assert.match(mainSource, /function setBusy\(value: boolean\): void\s*{[\s\S]*?isBusy = value;/);
  assert.match(mainSource, /function setBusy\(value: boolean\): void\s*{[\s\S]*?updateRunButtonStates\(\);/);
});
