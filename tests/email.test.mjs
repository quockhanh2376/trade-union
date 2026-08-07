/**
 * Behavioral tests for src/email.ts (production module).
 *
 * These import and execute the REAL production functions:
 *   normalizeEmail, parseEmails, sanitizeEmailInput, escapeHtml
 * No mirroring, no source-text contracts. A regression in email.ts fails
 * these tests directly.
 *
 * Run with:
 *   node --experimental-strip-types --test tests/email.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEmail,
  parseEmails,
  sanitizeEmailInput,
  escapeHtml,
} from "../src/email.ts";

// ── normalizeEmail ──────────────────────────────────────────────────

test("normalizeEmail lowercases and trims a valid address", () => {
  assert.equal(normalizeEmail("  Alice@Example.COM  "), "alice@example.com");
});

test("normalizeEmail returns null for invalid inputs", () => {
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail("   "), null);
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail("missing@tld"), null); // no dot in domain
  assert.equal(normalizeEmail("@example.com"), null); // empty local
  assert.equal(normalizeEmail("alice@"), null); // empty domain
  assert.equal(normalizeEmail("alice@example"), null); // no dot
});

test("normalizeEmail preserves plus-addressing and subdomains", () => {
  assert.equal(normalizeEmail("Alice+tag@Sub.Example.com"), "alice+tag@sub.example.com");
});

// ── parseEmails ─────────────────────────────────────────────────────

test("parseEmails splits on whitespace, commas, and semicolons", () => {
  const result = parseEmails("a@x.com b@x.com,c@x.com;d@x.com");
  assert.deepEqual(result, ["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
});

test("parseEmails deduplicates (case-insensitive after normalization)", () => {
  const result = parseEmails("A@X.com a@x.com B@x.com");
  assert.deepEqual(result, ["a@x.com", "b@x.com"]);
});

test("parseEmails ignores invalid tokens and blank lines", () => {
  const result = parseEmails("a@x.com\n\njunk\nb@x.com");
  assert.deepEqual(result, ["a@x.com", "b@x.com"]);
});

test("parseEmails returns empty array for empty/invalid input", () => {
  assert.deepEqual(parseEmails(""), []);
  assert.deepEqual(parseEmails("   junk   "), []);
});

test("parseEmails preserves first-seen order (not sorted)", () => {
  const result = parseEmails("zeta@x.com alpha@x.com mu@x.com");
  assert.deepEqual(result, ["zeta@x.com", "alpha@x.com", "mu@x.com"]);
});

// ── sanitizeEmailInput ──────────────────────────────────────────────

test("sanitizeEmailInput sorts, dedupes, and joins with newlines", () => {
  const result = sanitizeEmailInput("zeta@x.com alpha@x.com zeta@x.com");
  assert.equal(result, "alpha@x.com\nzeta@x.com");
});

test("sanitizeEmailInput strips blank lines and invalid tokens", () => {
  const result = sanitizeEmailInput("a@x.com\n\njunk\nb@x.com");
  assert.equal(result, "a@x.com\nb@x.com");
});

test("sanitizeEmailInput returns empty string for all-invalid input", () => {
  assert.equal(sanitizeEmailInput("junk junk junk"), "");
});

// ── escapeHtml ──────────────────────────────────────────────────────

test("escapeHtml escapes the five HTML-significant characters", () => {
  assert.equal(
    escapeHtml(`<a href="x" title='y'> & </a>`),
    "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt; &amp; &lt;/a&gt;"
  );
});

test("escapeHtml is idempotent-safe on already-escaped ampersand", () => {
  // Note: escapeHtml is NOT idempotent by design (it is for one-way output
  // encoding). We assert it produces the expected single-pass output.
  assert.equal(escapeHtml("&"), "&amp;");
  assert.equal(escapeHtml("&amp;"), "&amp;amp;");
});

test("escapeHtml handles empty string", () => {
  assert.equal(escapeHtml(""), "");
});

// ── Regression cases tied to real bug context ───────────────────────

test("Regression: parseEmails handles mixed delimiters in a single paste", () => {
  // Simulates a user pasting "a@x.com, b@x.com; c@x.com d@x.com"
  const result = parseEmails("a@x.com, b@x.com; c@x.com d@x.com");
  assert.deepEqual(result, ["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
});

test("Regression: normalizeEmail does not accept spaces inside the address", () => {
  // Per EMAIL_REGEX, internal spaces are invalid.
  assert.equal(normalizeEmail("alice bob@x.com"), null);
});
