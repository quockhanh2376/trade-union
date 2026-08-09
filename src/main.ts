import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import "./style.css";
import type { QueueName, GroupRunResult, ActionDetail, SeedEmails } from "./types.ts";
import { LOG_HISTORY_MAX_LINES } from "./constants.ts";
import { normalizeEmail, parseEmails, escapeHtml, sanitizeEmailInput } from "./email.ts";
import {
  loadStoredGroupEmails,
  saveGroupEmails,
  loadStoredAdminUpn,
  saveAdminUpn,
  loadLogHistory,
  saveLogHistory,
  loadBulkInputFromSession,
  saveBulkInputToSession,
  clearBulkInputFromSession,
} from "./storage.ts";
import {
  hasActiveAuthSession,
  rememberAuthSession,
  clearAuthSession,
  autoExpireAuthCache,
} from "./auth.ts";
import { state, ensureInQueue, removeFromQueue, moveEmail } from "./queue.ts";
import { resolveInitialQueues } from "./queue-startup.ts";
import { resolveRemovableEmails } from "./run-reconciliation.ts";
import { canMutateQueues, canStartRun, blockReason } from "./queue-mutation-guard.ts";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Cannot find #app root");
}

app.innerHTML = `
  <main class="canvas">
    <header class="hero">
      <div class="hero-top">
        <h1>Group Manager</h1>
        <p id="app-version" class="app-version"></p>
        <div class="hero-controls">
          <div class="group-email-inline">
            <label for="group-email">Group:</label>
            <input id="group-email" type="text" placeholder="group1@company.com, group2@company.com" />
          </div>
          <div class="admin-upn-inline">
            <label for="admin-upn">Admin:</label>
            <input id="admin-upn" type="text" placeholder="admin@aswhiteglobal.com" />
          </div>
        </div>
      </div>
    </header>

    <section class="composer">
      <div class="bulk-label-row">
        <span id="bulk-label">Email List</span>
        <span id="bulk-count" class="bulk-count-circle is-empty" title="Total emails in list" role="status" aria-label="Email count">0</span>
      </div>
      <div class="bulk-input-wrap">
        <div id="bulk-input" class="bulk-editable" contenteditable="true" data-placeholder="alice@company.com&#10;bob@company.com" role="textbox" aria-multiline="true" aria-labelledby="bulk-label"></div>
        <button id="clear-bulk-input" class="clear-bulk-input-btn" type="button" aria-label="Clear email list" title="Clear email list">X</button>
      </div>
      <div class="composer-actions">
        <button id="queue-to-add" class="btn solid">Add</button>
        <span id="add-count" class="pill-count" role="status" aria-label="Add queue count">0</span>
        <button id="queue-to-remove" class="btn remove-action">Remove</button>
        <span id="remove-count" class="pill-count pill-remove" role="status" aria-label="Remove queue count">0</span>
        <button id="clear-queues" class="btn ghost">Clear</button>
        <button id="undo-swap" class="btn ghost">Undo</button>
        <button id="view-log-history" class="btn ghost">View Logs</button>
        <div class="action-spacer"></div>
        <span id="result-success" class="result-badge success" style="display:none" role="status" aria-live="polite" aria-atomic="true" aria-label="Success count">✓ 0</span>
        <span id="result-fail" class="result-badge fail" style="display:none" role="status" aria-live="polite" aria-atomic="true" aria-label="Failure count">✗ 0</span>
      </div>
    </section>

    <section class="board" id="board" aria-label="Email queues">
      <article class="lane" aria-label="Add queue">
        <div class="lane-head">
          <button id="run-add" class="btn solid lane-run-btn">▶ Run</button>
        </div>
        <ul id="add-zone" data-list="add" class="drop-list" role="list" aria-label="Add queue items"></ul>
      </article>

      <article class="lane remove" aria-label="Remove queue">
        <div class="lane-head">
          <button id="run-remove" class="btn danger lane-run-btn">▶ Run</button>
        </div>
        <ul id="remove-zone" data-list="remove" class="drop-list" role="list" aria-label="Remove queue items"></ul>
      </article>
    </section>

    <section class="progress-section" id="progress-section" style="display:none;">
      <div class="progress-header">
        <span id="progress-label" class="progress-label" role="status" aria-live="polite" aria-atomic="true">Processing…</span>
        <span id="progress-percent" class="progress-percent"></span>
      </div>
      <div class="progress-track">
        <div id="progress-fill" class="progress-fill" style="width:0%" role="progressbar" aria-label="Action progress"></div>
      </div>
    </section>

    <div id="alert-region" role="alert" aria-live="assertive" class="sr-only"></div>

    <section class="result-table-section" id="result-table-section" style="display:none;">
      <h3>Result Details</h3>
      <div class="result-table-wrap">
        <table class="result-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Group</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="result-table-body"></tbody>
        </table>
      </div>
    </section>

    <section class="activity" id="activity">
      <h3>Activity Log</h3>
      <pre id="log-box"></pre>
    </section>

    <section id="history-modal" class="history-modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div class="history-modal-inner">
        <div class="history-head">
          <h3 id="history-title">Logs History</h3>
          <div class="history-actions">
            <button id="clear-log-history" class="btn ghost">Clear History</button>
            <button id="close-log-history" class="btn outline">Close</button>
          </div>
        </div>
        <pre id="history-box"></pre>
      </div>
    </section>
  </main>
`;

const bulkInput = document.querySelector<HTMLDivElement>("#bulk-input")!;
const bulkCount = document.querySelector<HTMLSpanElement>("#bulk-count")!;
const addZone = document.querySelector<HTMLUListElement>("#add-zone")!;
const removeZone = document.querySelector<HTMLUListElement>("#remove-zone")!;
const addCount = document.querySelector<HTMLSpanElement>("#add-count")!;
const removeCount = document.querySelector<HTMLSpanElement>("#remove-count")!;
const logBox = document.querySelector<HTMLPreElement>("#log-box")!;
const queueToAddBtn = document.querySelector<HTMLButtonElement>("#queue-to-add")!;
const queueToRemoveBtn = document.querySelector<HTMLButtonElement>("#queue-to-remove")!;
const clearQueuesBtn = document.querySelector<HTMLButtonElement>("#clear-queues")!;
const undoSwapBtn = document.querySelector<HTMLButtonElement>("#undo-swap")!;
const viewLogHistoryBtn = document.querySelector<HTMLButtonElement>("#view-log-history")!;
const runAddBtn = document.querySelector<HTMLButtonElement>("#run-add")!;
const runRemoveBtn = document.querySelector<HTMLButtonElement>("#run-remove")!;
const groupEmailInput = document.querySelector<HTMLInputElement>("#group-email")!;
const adminUpnInput = document.querySelector<HTMLInputElement>("#admin-upn")!;
const progressSection = document.querySelector<HTMLElement>("#progress-section")!;
const progressLabel = document.querySelector<HTMLSpanElement>("#progress-label")!;
const progressPercent = document.querySelector<HTMLSpanElement>("#progress-percent")!;
const progressFill = document.querySelector<HTMLDivElement>("#progress-fill")!;
const resultTableSection = document.querySelector<HTMLElement>("#result-table-section")!;
const resultTableBody = document.querySelector<HTMLTableSectionElement>("#result-table-body")!;
const resultSuccess = document.querySelector<HTMLSpanElement>("#result-success")!;
const resultFail = document.querySelector<HTMLSpanElement>("#result-fail")!;
const boardSection = document.querySelector<HTMLElement>("#board")!;
const activitySection = document.querySelector<HTMLElement>("#activity")!;
const historyModal = document.querySelector<HTMLElement>("#history-modal")!;
const historyBox = document.querySelector<HTMLPreElement>("#history-box")!;
const closeLogHistoryBtn = document.querySelector<HTMLButtonElement>("#close-log-history")!;
const clearLogHistoryBtn = document.querySelector<HTMLButtonElement>("#clear-log-history")!;
const alertRegion = document.querySelector<HTMLElement>("#alert-region")!;
const clearBulkInputBtn = document.querySelector<HTMLButtonElement>("#clear-bulk-input")!;

let isBusy = false;
/**
 * Set when the initial persisted-queue load failed. While true, queue-mutating
 * actions are blocked so an empty UI cannot overwrite saved data on disk. The
 * user must restart the app to retry the load. (F-02 load-failure safety.)
 */
let loadFailed = false;

/** Snapshot of the guard flags, consumed by the pure guard helpers (F-07/F-08). */
function guardState() {
  return { busy: isBusy, loadFailed };
}

/** Returns true when queue mutations / runs are allowed right now. */
function mutationsAllowed(): boolean {
  return canMutateQueues(guardState());
}

/** Logs the block reason (if any) and returns false when blocked. */
function requireMutationsAllowed(): boolean {
  if (mutationsAllowed()) return true;
  const reason = blockReason(guardState());
  if (reason) log(reason, true);
  return false;
}

const logHistory = loadLogHistory();

groupEmailInput.value = loadStoredGroupEmails();
adminUpnInput.value = loadStoredAdminUpn();

// ── UI helpers ────────────────────────────────────────────────────────────────


function clearBulkInput(): void {
  bulkInput.textContent = "";
  clearBulkInputFromSession();
  bulkInput.focus();
  updateBulkCount();
}

function updateBulkCount(): void {
  const count = parseEmails(bulkInput.innerText).length;
  bulkCount.textContent = String(count);
  bulkCount.classList.toggle("is-empty", count === 0);
}

function renderLogHistory(): void {
  historyBox.textContent = logHistory.length
    ? logHistory.join("\n")
    : "No logs history yet.";
}

let modalOpener: HTMLElement | null = null;

function openLogHistory(): void {
  modalOpener = document.activeElement as HTMLElement;
  renderLogHistory();
  historyModal.classList.remove("hidden");
  historyModal.setAttribute("aria-hidden", "false");
  // Focus the Close button so the user lands inside the dialog.
  closeLogHistoryBtn.focus();
}

function closeLogHistory(): void {
  historyModal.classList.add("hidden");
  historyModal.setAttribute("aria-hidden", "true");
  // Restore focus to the element that opened the modal.
  modalOpener?.focus();
  modalOpener = null;
}

/** Trap Tab/Shift+Tab within the history modal so focus cannot escape. */
function trapModalFocus(event: KeyboardEvent): void {
  if (historyModal.classList.contains("hidden")) return;
  if (event.key !== "Tab") return;

  const focusable = historyModal.querySelectorAll<HTMLElement>(
    'button, [href], input, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function clearLogHistory(): void {
  logHistory.length = 0;
  saveLogHistory(logHistory);
  renderLogHistory();
}

function log(message: string, error = false): void {
  const stamp = new Date().toLocaleTimeString();
  const line = `[${stamp}] ${message}`;
  logBox.textContent = `${line}\n${logBox.textContent ?? ""}`.trim();
  logHistory.unshift(line);
  if (logHistory.length > LOG_HISTORY_MAX_LINES) {
    logHistory.length = LOG_HISTORY_MAX_LINES;
  }
  saveLogHistory(logHistory);
  if (error) {
    logBox.classList.add("error");
    // Announce blocking errors via the assertive alert region.
    alertRegion.textContent = message;
  } else {
    logBox.classList.remove("error");
  }
}

function updateCounts(): void {
  addCount.textContent = String(state.add.length);
  removeCount.textContent = String(state.remove.length);
}

function updateRunButtonStates(busy = isBusy): void {
  runAddBtn.disabled = busy || state.add.length === 0;
  runRemoveBtn.disabled = busy || state.remove.length === 0;
}

function renderZone(target: QueueName): void {
  const zone = target === "add" ? addZone : removeZone;
  const otherLabel = target === "add" ? "Remove" : "Add";
  const arrowDir = target === "add" ? "Right" : "Left";
  const items = state[target]
    .map(
      (email) => `
        <li class="email-item" draggable="true" tabindex="0" data-email="${escapeHtml(email)}" data-source="${target}" role="listitem" aria-label="${escapeHtml(email)} in ${target} queue. Press Arrow ${arrowDir} to move to ${otherLabel} queue.">
          <span>${escapeHtml(email)}</span>
          <button class="delete-btn" data-email="${escapeHtml(email)}" data-source="${target}" title="Remove from queue" aria-label="Remove ${escapeHtml(email)} from ${target} queue">x</button>
        </li>
      `
    )
    .join("");
  zone.innerHTML = items || `<li class="empty">No emails</li>`;
}

function render(): void {
  renderZone("add");
  renderZone("remove");
  updateCounts();
  updateRunButtonStates();
}

function normalizeStatus(value: string): "ok" | "fail" {
  return value.trim().toLowerCase() === "ok" ? "ok" : "fail";
}

function renderResultDetails(details: ActionDetail[]): void {
  if (!details.length) {
    resultTableBody.innerHTML = "";
    resultTableSection.style.display = "none";
    return;
  }

  resultTableBody.innerHTML = details
    .map((item) => {
      const status = normalizeStatus(item.status);
      const statusLabel = status === "ok" ? "Ok" : "Fail";
      const note = item.message?.trim() ?? "";
      const rowTitle = note ? ` title="${escapeHtml(note)}"` : "";
      return `
        <tr class="status-${status}"${rowTitle}>
          <td>${escapeHtml(item.email)}</td>
          <td>${escapeHtml(item.group)}</td>
          <td class="cell-status">${statusLabel}</td>
        </tr>
      `;
    })
    .join("");

  resultTableSection.style.display = "";
}

async function autoRemoveCompletedEmails(
  action: QueueName,
  payload: string[],
  groups: string[],
  details: ActionDetail[],
  failedCount: number
): Promise<void> {
  const { removable, count } = resolveRemovableEmails({ action, payload, groups, details, failedCount });
  if (!count) {
    return;
  }

  state[action] = state[action].filter((email) => !removable.has(email));
  render();
  await persistQueues();
  log(`Auto removed ${count} completed email(s) from ${action.toUpperCase()} queue.`);
}

// ── Progress bar ──────────────────────────────────────────────────
function showProgressIndeterminate(label: string): void {
  progressSection.style.display = "";
  progressLabel.textContent = label;
  progressPercent.textContent = "";
  progressFill.style.width = "30%";
  progressFill.classList.add("indeterminate");
}

function showProgressDone(successCount: number, failedCount: number): void {
  progressFill.classList.remove("indeterminate");
  progressFill.style.width = "100%";

  if (failedCount > 0) {
    progressLabel.textContent = "Completed with errors";
    progressFill.classList.add("has-errors");
  } else {
    progressLabel.textContent = "Completed successfully";
  }
  progressPercent.textContent = `✓ ${successCount}  ✗ ${failedCount}`;

  // Update result badges
  resultSuccess.textContent = `✓ ${successCount}`;
  resultSuccess.style.display = "";
  resultFail.textContent = `✗ ${failedCount}`;
  resultFail.style.display = failedCount > 0 ? "" : "none";

  setTimeout(() => {
    progressSection.style.display = "none";
    progressFill.classList.remove("has-errors");
  }, 4000);
}

function hideProgress(): void {
  progressSection.style.display = "none";
  progressFill.classList.remove("indeterminate", "has-errors");
}

function showRunningLayout(): void {
  document.querySelectorAll(".drop-list").forEach((el) => el.classList.add("collapsed"));
  document.querySelectorAll(".lane").forEach((el) => el.classList.add("compact"));
  activitySection.classList.remove("closed");
  activitySection.classList.add("expanded");
}

function resetLayout(closeActivityLog: boolean): void {
  document.querySelectorAll(".drop-list").forEach((el) => el.classList.remove("collapsed"));
  document.querySelectorAll(".lane").forEach((el) => el.classList.remove("compact"));
  activitySection.classList.remove("expanded");
  if (closeActivityLog) {
    activitySection.classList.add("closed");
  }
}

// ── Queue operations ──────────────────────────────────────────────
async function persistQueues(): Promise<void> {
  await invoke("save_email_queues", { add: state.add, remove: state.remove });
}

async function queueFromInput(target: QueueName): Promise<void> {
  if (!requireMutationsAllowed()) return;
  const emails = parseEmails(bulkInput.innerText);
  if (!emails.length) {
    log("No valid emails found in the input area.", true);
    return;
  }
  ensureInQueue(target, emails);
  // Auto-sort, deduplicate, and remove blank entries from the input area
  bulkInput.textContent = sanitizeEmailInput(bulkInput.innerText);
  updateBulkCount();
  render();
  await persistQueues();
  log(`Queued ${emails.length} email(s) into ${target.toUpperCase()}.`);
  saveBulkInputToSession(bulkInput.innerText);
}

async function clearQueues(): Promise<void> {
  if (!requireMutationsAllowed()) return;
  state.add = [];
  state.remove = [];
  bulkInput.textContent = "";
  updateBulkCount();
  renderResultDetails([]);
  clearBulkInputFromSession();
  resultSuccess.style.display = "none";
  resultFail.style.display = "none";
  render();
  await persistQueues();
  resetLayout(true);
  log("Cleared ADD and REMOVE queues.");
}

async function undoSwapQueues(): Promise<void> {
  if (!requireMutationsAllowed()) return;
  const prevAdd = [...state.add];
  state.add = [...state.remove].sort();
  state.remove = prevAdd.sort();
  render();
  await persistQueues();
  log("Undo applied: swapped ADD and REMOVE queues.");
}

// ── Run action ────────────────────────────────────────────────────
async function runAction(action: QueueName): Promise<void> {
  // F-07: reject a second concurrent run (double-click, Add+Remove overlap).
  // Checked before any state is snapshotted so a blocked call has no side
  // effects.
  if (!canStartRun(guardState())) {
    log(blockReason(guardState()) ?? "Cannot start an action right now.", true);
    return;
  }
  const payload = [...state[action]];
  if (!payload.length) {
    log(`Queue ${action.toUpperCase()} is empty.`, true);
    return;
  }

  const groups = saveGroupEmails(groupEmailInput.value);
  if (!groups.length) {
    log("Please enter at least one valid group email before running actions.", true);
    return;
  }
  groupEmailInput.value = groups.join(", ");

  const adminUpnValue = adminUpnInput.value.trim();
  const adminUpn = adminUpnValue ? normalizeEmail(adminUpnValue) : null;
  if (adminUpnValue && !adminUpn) {
    log("Admin account email is invalid.", true);
    return;
  }
  if (adminUpn) {
    adminUpnInput.value = adminUpn;
    saveAdminUpn(adminUpn);
  }

  const forceReconnect = !hasActiveAuthSession();

  setBusy(true);
  showProgressIndeterminate(
    `${action === "add" ? "Adding" : "Removing"} ${payload.length} email(s) for ${groups.length} group(s)...`
  );
  showRunningLayout();

  try {
    await persistQueues();
    if (hasActiveAuthSession()) {
      log("Reusing Microsoft admin auth session for this app session.");
    } else {
      log("Opening Microsoft sign-in window. Complete 2FA when prompted.");
    }

    if (groups.length > 1) {
      log(`Group order: ${groups.join(" -> ")}`);
    }

    const result = await invoke<GroupRunResult>("run_group_action", {
      action,
      emails: payload,
      groupEmails: groups,
      adminUpn: adminUpn ?? null,
      forceReconnect
    });

    log(`Done ${result.action.toUpperCase()} for ${groups.length} group(s): ${result.successCount} success, ${result.failedCount} failed.`);
    if (result.stdout) log(result.stdout);
    if (result.stderr) log(result.stderr, true);
    renderResultDetails(result.details ?? []);
    await autoRemoveCompletedEmails(action, payload, groups, result.details ?? [], result.failedCount);
    rememberAuthSession();

    showProgressDone(result.successCount, result.failedCount);
  } catch (error) {
    log(String(error), true);
    hideProgress();
  } finally {
    setBusy(false);
    resetLayout(true);
  }
}

function setBusy(value: boolean): void {
  isBusy = value;
  // When the startup load failed, queue-mutating controls stay locked even
  // when a transient busy period ends, so an empty UI can't overwrite the
  // saved queues on disk. (F-02 load-failure safety.)
  const effectivelyBusy = value || loadFailed;
  [
    queueToAddBtn,
    queueToRemoveBtn,
    clearQueuesBtn,
    undoSwapBtn,
    viewLogHistoryBtn,
    groupEmailInput,
    adminUpnInput,
    clearBulkInputBtn
  ].forEach((el) => {
    el.disabled = effectivelyBusy;
  });
  boardSection.setAttribute("aria-busy", String(value));
  updateRunButtonStates();
}
/**
 * Wire delegated event listeners on each queue zone (called ONCE at init,
 * not on every render). This replaces the old bindDynamicEvents() pattern
 * that re-attached N listeners per queue item on every render call (F-14).
 *
 * Delegation: 2 listeners total (one per <ul>), regardless of queue size.
 * Event target is resolved via closest() to find the originating item/button.
 */
function wireQueueDelegation(zone: HTMLUListElement): void {
  // Drag start — delegated to zone, finds the originating .email-item
  zone.addEventListener("dragstart", (event: DragEvent) => {
    const item = (event.target as HTMLElement)?.closest<HTMLLIElement>(".email-item");
    if (!item || !event.dataTransfer) return;
    const email = item.dataset.email ?? "";
    const source = item.dataset.source ?? "";
    if (!email) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", email);
    event.dataTransfer.setData("application/x-source", source);
  });

  // Keyboard move — delegated to zone, finds the originating .email-item
  zone.addEventListener("keydown", async (event: KeyboardEvent) => {
    const item = (event.target as HTMLElement)?.closest<HTMLLIElement>(".email-item");
    if (!item) return;
    if (!requireMutationsAllowed()) return;
    const email = item.dataset.email ?? "";
    const source = item.dataset.source as QueueName;
    if (!email || (source !== "add" && source !== "remove")) return;

    const target: QueueName | null =
      event.key === "ArrowRight" && source === "add" ? "remove"
      : event.key === "ArrowLeft" && source === "remove" ? "add"
      : null;

    if (!target) return;
    event.preventDefault();
    moveEmail(email, source, target);
    render();
    await persistQueues();
    log(`Moved ${email} to ${target.toUpperCase()} queue.`);
  });

  // Delete click — delegated to zone, finds the originating .delete-btn
  zone.addEventListener("click", async (event: MouseEvent) => {
    const button = (event.target as HTMLElement)?.closest<HTMLButtonElement>(".delete-btn");
    if (!button) return;
    if (!requireMutationsAllowed()) return;
    const email = button.dataset.email ?? "";
    const source = button.dataset.source as QueueName;
    if (!email || (source !== "add" && source !== "remove")) return;
    removeFromQueue(source, email);
    render();
    await persistQueues();
  });
}

function wireDropZone(zone: HTMLUListElement, target: QueueName): void {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drop-hover");
  });
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("drop-hover");
  });
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    zone.classList.remove("drop-hover");
    if (!requireMutationsAllowed()) return;
    const email = event.dataTransfer?.getData("text/plain") ?? "";
    const sourceRaw = event.dataTransfer?.getData("application/x-source") ?? "";
    const source = sourceRaw === "add" || sourceRaw === "remove" ? sourceRaw : null;
    if (!email || !source) return;
    moveEmail(email, source, target);
    render();
    await persistQueues();
  });
}

// ── Load seed files ───────────────────────────────────────────────
async function initializeQueues(): Promise<void> {
  // Restore the bulk-input draft (session-only, never persisted to the backend)
  bulkInput.textContent = loadBulkInputFromSession();
  updateBulkCount();

  // Load persisted queue state from the backend before touching it.
  // The resolver never persists; on load failure it returns the empty default
  // without overwriting saved data (F-02 — queue-wipe-on-startup).
  const result = await resolveInitialQueues({
    loadPersistedQueues: () => invoke<SeedEmails>("load_seed_emails"),
    onError: (message) => log(message, true),
  });
  state.add = result.queues.add;
  state.remove = result.queues.remove;

  // If the persisted load failed, lock queue mutations so an empty UI cannot
  // overwrite the saved queues on disk via a later Add/Remove/Clear action.
  loadFailed = !result.loaded;
  if (loadFailed) {
    log("Queues are read-only until the app is restarted and the saved state loads. Restart to retry.", true);
    setBusy(true);
    bulkInput.contentEditable = "false";
  }

  render();
  resetLayout(false);
}

// ── Event listeners ───────────────────────────────────────────────
queueToAddBtn.addEventListener("click", () => void queueFromInput("add"));
queueToRemoveBtn.addEventListener("click", () => void queueFromInput("remove"));
clearQueuesBtn.addEventListener("click", () => void clearQueues());
undoSwapBtn.addEventListener("click", () => void undoSwapQueues());
viewLogHistoryBtn.addEventListener("click", () => openLogHistory());
runAddBtn.addEventListener("click", () => void runAction("add"));
runRemoveBtn.addEventListener("click", () => void runAction("remove"));
closeLogHistoryBtn.addEventListener("click", () => closeLogHistory());
clearLogHistoryBtn.addEventListener("click", () => clearLogHistory());
clearBulkInputBtn.addEventListener("click", () => clearBulkInput());

groupEmailInput.addEventListener("change", () => {
  const groups = saveGroupEmails(groupEmailInput.value);
  if (groups.length) {
    groupEmailInput.value = groups.join(", ");
  }
});

adminUpnInput.addEventListener("change", () => {
  const normalized = normalizeEmail(adminUpnInput.value);
  if (!normalized) {
    adminUpnInput.value = "";
    return;
  }
  adminUpnInput.value = normalized;
  saveAdminUpn(normalized);
});

bulkInput.addEventListener("input", () => {
  saveBulkInputToSession(bulkInput.innerText);
  updateBulkCount();
});

historyModal.addEventListener("click", (event) => {
  if (event.target === historyModal) {
    closeLogHistory();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !historyModal.classList.contains("hidden")) {
    closeLogHistory();
  }
  trapModalFocus(event);
});

// ── Init ──────────────────────────────────────────────────────────
setInterval(() => {
  autoExpireAuthCache(log);
}, 15000);

window.addEventListener("beforeunload", () => {
  clearAuthSession();
});

wireDropZone(addZone, "add");
wireDropZone(removeZone, "remove");
wireQueueDelegation(addZone);
wireQueueDelegation(removeZone);
renderLogHistory();
void initializeQueues();

// ── Version display ───────────────────────────────────────────────
const appVersionEl = document.getElementById("app-version");
if (appVersionEl) {
  getVersion().then((v) => {
    appVersionEl.textContent = `v${v}`;
  }).catch(() => {
    appVersionEl.textContent = "";
  });
}

