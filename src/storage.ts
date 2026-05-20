import {
  GROUP_EMAILS_STORAGE_KEY,
  LEGACY_GROUP_EMAIL_STORAGE_KEY,
  ADMIN_UPN_STORAGE_KEY,
  LOG_HISTORY_STORAGE_KEY,
  BULK_INPUT_SESSION_KEY,
  LOG_HISTORY_MAX_LINES,
  DEFAULT_GROUP_EMAIL,
} from "./constants";
import { normalizeEmail, parseEmails } from "./email";

export function loadStoredGroupEmails(): string {
  try {
    const saved =
      localStorage.getItem(GROUP_EMAILS_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_GROUP_EMAIL_STORAGE_KEY);
    const parsed = parseEmails(saved ?? "");
    if (!parsed.length) return DEFAULT_GROUP_EMAIL;
    return parsed.join(", ");
  } catch {
    return DEFAULT_GROUP_EMAIL;
  }
}

export function saveGroupEmails(value: string): string[] {
  const parsed = parseEmails(value);
  if (!parsed.length) return [];
  const serialized = parsed.join(", ");
  try {
    localStorage.setItem(GROUP_EMAILS_STORAGE_KEY, serialized);
    localStorage.setItem(LEGACY_GROUP_EMAIL_STORAGE_KEY, parsed[0]);
  } catch { }
  return parsed;
}

export function loadStoredAdminUpn(): string {
  try {
    const saved = localStorage.getItem(ADMIN_UPN_STORAGE_KEY);
    if (!saved) return "";
    return normalizeEmail(saved) ?? "";
  } catch {
    return "";
  }
}

export function saveAdminUpn(value: string): void {
  try {
    localStorage.setItem(ADMIN_UPN_STORAGE_KEY, value);
  } catch { }
}

export function loadLogHistory(): string[] {
  try {
    const raw = localStorage.getItem(LOG_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .slice(0, LOG_HISTORY_MAX_LINES);
  } catch {
    return [];
  }
}

export function saveLogHistory(history: string[]): void {
  try {
    localStorage.setItem(
      LOG_HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(0, LOG_HISTORY_MAX_LINES))
    );
  } catch { }
}

export function loadBulkInputFromSession(): string {
  try {
    return sessionStorage.getItem(BULK_INPUT_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveBulkInputToSession(text: string): void {
  try {
    sessionStorage.setItem(BULK_INPUT_SESSION_KEY, text);
  } catch { }
}

export function clearBulkInputFromSession(): void {
  try {
    sessionStorage.removeItem(BULK_INPUT_SESSION_KEY);
  } catch { }
}
