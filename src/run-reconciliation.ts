import type { ActionDetail, ActionStatus, QueueName } from "./types.ts";
import { normalizeEmail } from "./email.ts";

/**
 * Internal status classification for an ActionDetail result.
 * Mirrors the runtime normalization done in main.ts's normalizeStatus().
 */
function classifyStatus(raw: string): ActionStatus {
  return raw.trim().toLowerCase() === "ok" ? "ok" : "fail";
}

export interface ReconcileInput {
  /** Which queue the action targeted (add/remove). */
  action: QueueName;
  /** The emails that were submitted for this run (the payload snapshot). */
  payload: string[];
  /** The distribution groups the run targeted. */
  groups: string[];
  /** Per-(email,group) result rows returned by the backend. */
  details: ActionDetail[];
  /** Aggregate failed count reported by the backend. */
  failedCount: number;
}

export interface ReconcileResult {
  /**
   * The set of emails (already normalized) that completed successfully across
   * ALL targeted groups and may be removed from the action's queue.
   * Callers filter the queue by this set; this helper does not mutate queues.
   */
  removable: Set<string>;
  /** How many emails were marked removable. */
  count: number;
}

/**
 * Decide which emails from a run payload may be auto-removed from the queue.
 *
 * Rules (mirrors the previous inline logic in main.ts::autoRemoveCompletedEmails,
 * now extracted so it is unit-testable without the DOM):
 *
 * 1. If per-(email,group) details are available, an email is removable only if
 *    it has an "ok" result for EVERY targeted group and no failure for any.
 *    This prevents removing an email that succeeded in one group but failed in
 *    another (multi-group runs).
 * 2. If details are empty (older script / no per-row output), fall back to the
 *    aggregate failedCount: when failedCount === 0, treat the whole payload as
 *    removable; otherwise remove nothing.
 * 3. Invalid/malformed detail rows (bad email or group) are ignored and never
 *    count toward success.
 *
 * This function is PURE: it does not touch the DOM, queues, or persistence.
 * The caller is responsible for applying `removable` to queue state.
 */
export function resolveRemovableEmails(input: ReconcileInput): ReconcileResult {
  const removable = new Set<string>();

  if (input.details.length) {
    const expectedGroups = input.groups.length;
    const stats = new Map<string, { okGroups: Set<string>; hasFail: boolean }>();

    for (const item of input.details) {
      const email = normalizeEmail(item.email);
      const group = normalizeEmail(item.group);
      if (!email || !group) continue;

      let record = stats.get(email);
      if (!record) {
        record = { okGroups: new Set<string>(), hasFail: false };
        stats.set(email, record);
      }

      if (classifyStatus(item.status) === "ok") {
        record.okGroups.add(group);
      } else {
        record.hasFail = true;
      }
    }

    for (const email of input.payload) {
      const record = stats.get(email);
      if (!record) continue;
      if (!record.hasFail && record.okGroups.size === expectedGroups) {
        removable.add(email);
      }
    }
  } else if (input.failedCount === 0) {
    for (const email of input.payload) {
      removable.add(email);
    }
  }

  return { removable, count: removable.size };
}
