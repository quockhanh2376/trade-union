import type { QueueName, SeedEmails } from "./types.ts";

/**
 * Default queue state used when no persisted data is available or a load
 * fails. Kept here so the startup helper and any caller share one source of
 * truth for the "empty" shape.
 */
export function emptyQueues(): Record<QueueName, string[]> {
  return { add: [], remove: [] };
}

export interface QueueStore {
  add: string[];
  remove: string[];
}

export interface QueueStartupDeps {
  /** Loads the persisted queue state from the backend. Must reject on error. */
  loadPersistedQueues: () => Promise<SeedEmails>;
  /** Called when startup needs to log a non-fatal error (e.g. load failed). */
  onError?: (message: string) => void;
}

export interface QueueStartupResult {
  /** The queue state to apply to the UI. */
  queues: QueueStore;
  /** True when the persisted state was loaded successfully. */
  loaded: boolean;
}

/**
 * Resolve the initial queue state for app startup.
 *
 * Contract (F-02 — queue-wipe-on-startup):
 *  1. Load the persisted queue state first via `loadPersistedQueues`.
 *  2. On success, return the loaded queues verbatim (no mutation, no persist).
 *  3. On failure, return the empty default but signal `loaded: false` so the
 *     caller can avoid overwriting saved data. This helper never persists;
 *     persistence is the responsibility of explicit user actions only.
 *  4. Never throws — a load failure is reported via `onError` and degraded
 *     gracefully to the empty default.
 *
 * This function is pure with respect to the DOM and to Tauri: it takes its
 * loader as a dependency so it can be unit-tested under node:test without a
 * DOM or Tauri runtime. `src/main.ts` wires real `invoke` + `log` into it.
 */
export async function resolveInitialQueues(
  deps: QueueStartupDeps
): Promise<QueueStartupResult> {
  try {
    const seed = await deps.loadPersistedQueues();
    return {
      queues: { add: [...seed.add], remove: [...seed.remove] },
      loaded: true,
    };
  } catch (error) {
    deps.onError?.(`Cannot load saved queues; keeping empty state. ${String(error)}`);
    return { queues: emptyQueues(), loaded: false };
  }
}
