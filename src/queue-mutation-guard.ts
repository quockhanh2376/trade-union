/**
 * Guard logic for queue mutations and run actions (F-07/F-08).
 *
 * Single source of truth for whether the UI may mutate the queues or start a
 * new run. Two independent reasons block mutations:
 *   1. `busy`  — a run action is in progress (snapshot taken, backend running).
 *   2. `loadFailed` — the persisted queue failed to load at startup; mutating
 *      an empty UI would overwrite saved data on disk (F-02).
 *
 * This module is pure (no DOM, no Tauri) so it can be unit-tested under
 * node:test. `src/main.ts` owns the actual `busy`/`loadFailed` flags and
 * passes them into `canMutateQueues`/`canStartRun` at every entry point.
 */

export interface GuardState {
    busy: boolean;
    loadFailed: boolean;
}

/** True when neither a run is active nor the startup load failed. */
export function canMutateQueues(state: GuardState): boolean {
    return !state.busy && !state.loadFailed;
}

/**
 * True when a new run action may start. This is intentionally identical to
 * `canMutateQueues` today: a run must not begin while another run is active,
 * and must not begin when the saved state could not be loaded. Kept as a
 * separate function so the run-entry policy can evolve independently from
 * the mutation policy if needed.
 */
export function canStartRun(state: GuardState): boolean {
    return canMutateQueues(state);
}

/** Reason a mutation/run is blocked, for logging. Returns null when allowed. */
export function blockReason(state: GuardState): string | null {
    if (state.busy) {
        return "An action is already running. Wait for it to finish before changing the queues.";
    }
    if (state.loadFailed) {
        return "Queues are read-only because the saved state could not be loaded. Restart the app to retry.";
    }
    return null;
}
