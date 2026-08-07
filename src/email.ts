import { EMAIL_REGEX } from "./constants.ts";

export function normalizeEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (!value || !EMAIL_REGEX.test(value)) return null;
  return value;
}

export function parseEmails(text: string): string[] {
  const unique = new Set<string>();
  text
    .split(/[\s,;]+/g)
    .map((token) => normalizeEmail(token))
    .filter((value): value is string => value !== null)
    .forEach((email) => unique.add(email));
  return [...unique];
}

/**
 * Returns a cleaned, sorted, deduplicated, newline-separated email string
 * suitable for rendering back into the bulk-input area.
 */
export function sanitizeEmailInput(text: string): string {
  const unique = new Set<string>();
  text
    .split(/[\s,;]+/g)
    .map((token) => normalizeEmail(token))
    .filter((value): value is string => value !== null)
    .sort()
    .forEach((email) => unique.add(email));
  return [...unique].join("\n");
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
