/**
 * Contract tests for accessibility semantics (F-13).
 *
 * These read the REAL production source (src/main.ts template string +
 * src/style.css) and assert accessibility properties without running a DOM.
 * A regression that removes ARIA roles, labels, or focus-visible styles
 * fails here.
 *
 * Run with:
 *   node --test tests/accessibility-contract.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

// ── 1. Dialog semantics (history modal) ─────────────────────────────

test("history modal has role=dialog, aria-modal, and aria-labelledby", () => {
  assert.match(mainSource, /role="dialog"/, "history modal must have role=dialog");
  assert.match(mainSource, /aria-modal="true"/, "history modal must have aria-modal=true");
  assert.match(mainSource, /aria-labelledby="history-title"/, "modal must reference its title");
  assert.match(mainSource, /<h3 id="history-title"/, "history-title heading must exist");
});

// ── 2. Focus management wiring for modal ────────────────────────────

test("openLogHistory saves opener and focuses inside modal", () => {
  assert.match(mainSource, /modalOpener = document\.activeElement/, "openLogHistory must save opener");
  assert.match(mainSource, /closeLogHistoryBtn\.focus\(\)/, "openLogHistory must focus Close button");
});

test("closeLogHistory restores focus to opener", () => {
  assert.match(mainSource, /modalOpener\?\.focus\(\)/, "closeLogHistory must restore focus");
});

test("Escape closes modal (document keydown handler)", () => {
  assert.match(mainSource, /event\.key === "Escape"[\s\S]*closeLogHistory/, "Escape must close modal");
});

test("Tab/Shift+Tab trap implemented (trapModalFocus)", () => {
  assert.match(mainSource, /function trapModalFocus/, "trapModalFocus must exist");
  assert.match(mainSource, /trapModalFocus\(event\)/, "trapModalFocus must be wired to keydown");
});

// ── 3. Bulk contenteditable semantics ───────────────────────────────

test("bulk input has role=textbox, aria-multiline, and aria-labelledby", () => {
  assert.match(mainSource, /id="bulk-input"[^>]*role="textbox"/, "bulk input must have role=textbox");
  assert.match(mainSource, /id="bulk-input"[^>]*aria-multiline="true"/, "bulk input must be multiline");
  assert.match(mainSource, /id="bulk-input"[^>]*aria-labelledby="bulk-label"/, "bulk input must use aria-labelledby");
  assert.match(mainSource, /id="bulk-label"/, "visible label element must exist");
});

test("bulk label is NOT a <label for> (contenteditable can't use native association)", () => {
  assert.doesNotMatch(mainSource, /<label for="bulk-input"/, "must not use <label for> for contenteditable");
});

// ── 4. Delete button contextual aria-label ──────────────────────────

test("delete button has contextual aria-label with email + queue", () => {
  assert.match(
    mainSource,
    /aria-label="Remove \$\{escapeHtml\(email\)\} from \$\{target\} queue"/,
    "delete button aria-label must include email + queue context"
  );
});

// ── 5. Queue items keyboard accessible (drag/drop equivalent) ───────

test("queue items have tabindex=0 for keyboard focus", () => {
  assert.match(mainSource, /tabindex="0"/, "queue items must have tabindex=0");
});

test("queue item keydown handler moves email on Arrow keys", () => {
  assert.match(mainSource, /ArrowRight.*source === "add".*"remove"/, "ArrowRight must move from add to remove");
  assert.match(mainSource, /ArrowLeft.*source === "remove".*"add"/, "ArrowLeft must move from remove to add");
  assert.match(mainSource, /moveEmail\(email, source, target\)/, "keydown must call moveEmail");
});

test("queue item aria-label includes keyboard instruction", () => {
  assert.match(mainSource, /Press Arrow/, "queue item aria-label must include keyboard instruction");
});

// ── 6. Progress semantics ───────────────────────────────────────────

test("progress bar has role=progressbar + label, NO fake aria-valuenow (indeterminate)", () => {
  assert.match(mainSource, /role="progressbar"/, "progress fill must have role=progressbar");
  assert.match(mainSource, /aria-label="Action progress"/, "progress must have accessible label");
  // Progress is indeterminate animation — do not expose a fake numeric value.
  assert.doesNotMatch(mainSource, /id="progress-fill"[^>]*aria-valuenow/, "progressbar must NOT hard-code aria-valuenow (indeterminate)");
});

test("progress label has role=status aria-live=polite aria-atomic", () => {
  assert.match(mainSource, /id="progress-label"[^>]*role="status"/, "progress label must have role=status");
  assert.match(mainSource, /id="progress-label"[^>]*aria-live="polite"/, "progress label must have aria-live");
  assert.match(mainSource, /id="progress-label"[^>]*aria-atomic="true"/, "progress label must have aria-atomic");
});

// ── 7. Result badges (status region) ────────────────────────────────

test("result badges have role=status, aria-live=polite, aria-atomic", () => {
  assert.match(mainSource, /id="result-success"[^>]*role="status"/, "success badge must have role=status");
  assert.match(mainSource, /id="result-success"[^>]*aria-live="polite"/, "success badge must have aria-live");
  assert.match(mainSource, /id="result-success"[^>]*aria-atomic="true"/, "success badge must have aria-atomic");
});

// ── 8. Alert region for blocking errors ─────────────────────────────

test("alert region exists with role=alert aria-live=assertive", () => {
  assert.match(mainSource, /id="alert-region"[^>]*role="alert"/, "alert region must exist with role=alert");
  assert.match(mainSource, /id="alert-region"[^>]*aria-live="assertive"/, "alert region must have assertive live");
});

test("log() function announces errors via alert region", () => {
  assert.match(mainSource, /alertRegion\.textContent = message/, "log() must set alertRegion text for errors");
});

// ── 9. Activity log does NOT spam aria-live ─────────────────────────

test("activity log does not have aria-live (avoids screen-reader spam)", () => {
  assert.doesNotMatch(mainSource, /id="log-box"[^>]*aria-live/, "log box must not have aria-live to avoid spam");
  assert.doesNotMatch(mainSource, /id="log-box"[^>]*role="log"/, "log box must not have role=log to avoid spam");
});

// ── 10. Busy semantics ──────────────────────────────────────────────

test("setBusy toggles aria-busy on the board section", () => {
  assert.match(mainSource, /boardSection\.setAttribute\("aria-busy"/, "setBusy must set aria-busy on board");
});

// ── 11. Focus-visible ───────────────────────────────────────────────

test("CSS has :focus-visible for buttons, inputs, contenteditable, and queue items", () => {
  assert.match(styleSource, /\.btn:focus-visible/, "buttons must have :focus-visible");
  assert.match(styleSource, /\.group-email-inline input:focus-visible/, "group email input must have :focus-visible");
  assert.match(styleSource, /\.bulk-editable:focus-visible/, "bulk input must have :focus-visible");
  assert.match(styleSource, /\.email-item:focus-visible/, "queue items must have :focus-visible");
});

test("no bare outline:none on base input rules (without focus-visible replacement)", () => {
  const inputBlock = styleSource.match(/\.group-email-inline input,\s*\.admin-upn-inline input\s*\{[\s\S]*?\}/);
  if (inputBlock) {
    assert.doesNotMatch(inputBlock[0], /outline:\s*none/, "base input rule must not have outline:none");
  }
  const bulkBlock = styleSource.match(/\.bulk-editable\s*\{[\s\S]*?\}/);
  if (bulkBlock) {
    assert.doesNotMatch(bulkBlock[0], /outline:\s*none/, "base bulk-editable rule must not have outline:none");
  }
});

// ── 12. No positive tabindex ────────────────────────────────────────

test("no positive tabindex in template", () => {
  assert.doesNotMatch(mainSource, /tabindex="[1-9]/, "no positive tabindex allowed");
});

// ── 13. sr-only CSS class exists ────────────────────────────────────

test("sr-only CSS class exists for visually hidden content", () => {
  assert.match(styleSource, /\.sr-only\s*\{/, "sr-only class must exist");
});
