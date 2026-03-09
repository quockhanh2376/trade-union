import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type QueueName = "add" | "remove";

interface GroupRunResult {
  action: string;
  processed: number;
  successCount: number;
  failedCount: number;
  details: ActionDetail[];
  stdout: string;
  stderr: string;
}

interface ActionDetail {
  email: string;
  group: string;
  status: string;
  message?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_GROUP_EMAIL = "ASWVN_TradeUnion@aswhiteglobal.com";
const GROUP_EMAILS_STORAGE_KEY = "trade-union.group-emails";
const LEGACY_GROUP_EMAIL_STORAGE_KEY = "trade-union.group-email";
const ADMIN_UPN_STORAGE_KEY = "trade-union.admin-upn";
const LOG_HISTORY_STORAGE_KEY = "trade-union.log-history";
const BULK_INPUT_SESSION_KEY = "trade-union.bulk-input";
const LOG_HISTORY_MAX_LINES = 5000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CREDENTIAL_FORGET_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const state: Record<QueueName, string[]> = {
  add: [],
  remove: []
};

let lastActivityTimestamp = Date.now();
let credentialAutoForgetTriggered = false;
let credentialAutoForgetRunning = false;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Cannot find #app root");
}

app.innerHTML = `
  <main class="canvas">
    <header class="hero">
      <div class="hero-top">
        <h1>Group Manager</h1>
        <div class="hero-controls">
          <div class="group-email-inline">
            <label for="group-email">Group:</label>
            <input id="group-email" type="text" placeholder="group1@company.com; group2@company.com" />
          </div>
          <div class="admin-upn-inline">
            <label for="admin-upn">Admin:</label>
            <input id="admin-upn" type="text" placeholder="admin@aswhiteglobal.com" />
          </div>
          <div class="admin-password-inline">
            <label for="admin-password">Password:</label>
            <input id="admin-password" type="password" placeholder="Enter admin password" autocomplete="off" />
          </div>
        </div>
      </div>
    </header>

    <section class="composer">
      <label for="bulk-input">Email List</label>
      <div id="bulk-input" class="bulk-editable" contenteditable="true" data-placeholder="alice@company.com&#10;bob@company.com"></div>
      <div class="composer-actions">
        <button id="queue-to-add" class="btn solid">Queue to Add</button>
        <span id="add-count" class="pill-count">0</span>
        <button id="queue-to-remove" class="btn outline">Queue to Remove</button>
        <span id="remove-count" class="pill-count pill-remove">0</span>
        <button id="clear-queues" class="btn ghost">Clear</button>
        <button id="undo-swap" class="btn ghost">Undo</button>
        <button id="view-log-history" class="btn ghost">View Logs</button>
        <div class="action-spacer"></div>
        <span id="result-success" class="result-badge success" style="display:none">✓ 0</span>
        <span id="result-fail" class="result-badge fail" style="display:none">✗ 0</span>
      </div>
    </section>

    <section class="board" id="board">
      <article class="lane">
        <div class="lane-head">
          <button id="run-add" class="btn solid lane-run-btn">▶ Run Add</button>
        </div>
        <ul id="add-zone" data-list="add" class="drop-list"></ul>
      </article>

      <article class="lane remove">
        <div class="lane-head">
          <button id="run-remove" class="btn danger lane-run-btn">▶ Run Remove</button>
        </div>
        <ul id="remove-zone" data-list="remove" class="drop-list"></ul>
      </article>
    </section>

    <section class="progress-section" id="progress-section" style="display:none;">
      <div class="progress-header">
        <span id="progress-label" class="progress-label">Processing…</span>
        <span id="progress-percent" class="progress-percent"></span>
      </div>
      <div class="progress-track">
        <div id="progress-fill" class="progress-fill" style="width:0%"></div>
      </div>
    </section>

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

    <section id="history-modal" class="history-modal hidden" aria-hidden="true">
      <div class="history-modal-inner">
        <div class="history-head">
          <h3>Logs History</h3>
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
const adminPasswordInput = document.querySelector<HTMLInputElement>("#admin-password")!;
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

const logHistory = loadLogHistory();

groupEmailInput.value = loadStoredGroupEmails();
adminUpnInput.value = loadStoredAdminUpn();
void refreshSavedAdminCredentialHint();

// ── Activity tracking ─────────────────────────────────────────────
function touchActivity(): void {
  lastActivityTimestamp = Date.now();
  credentialAutoForgetTriggered = false;
}

function isIdle(): boolean {
  return Date.now() - lastActivityTimestamp > IDLE_TIMEOUT_MS;
}

document.addEventListener("click", touchActivity);
document.addEventListener("keydown", touchActivity);
document.addEventListener("dragstart", touchActivity);

// ── Helpers ───────────────────────────────────────────────────────
function loadStoredGroupEmails(): string {
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

function saveGroupEmails(value: string): string[] {
  const parsed = parseEmails(value);
  if (!parsed.length) return [];

  const serialized = parsed.join(", ");
  try {
    localStorage.setItem(GROUP_EMAILS_STORAGE_KEY, serialized);
    localStorage.setItem(LEGACY_GROUP_EMAIL_STORAGE_KEY, parsed[0]);
  } catch { }
  return parsed;
}

function loadStoredAdminUpn(): string {
  try {
    const saved = localStorage.getItem(ADMIN_UPN_STORAGE_KEY);
    if (!saved) return "";
    return normalizeEmail(saved) ?? "";
  } catch {
    return "";
  }
}

function saveAdminUpn(value: string): void {
  try {
    localStorage.setItem(ADMIN_UPN_STORAGE_KEY, value);
  } catch { }
}

async function refreshSavedAdminCredentialHint(): Promise<void> {
  const normalized = normalizeEmail(adminUpnInput.value);
  if (!normalized) {
    adminPasswordInput.placeholder = "Enter admin password";
    return;
  }

  try {
    const hasSaved = await invoke<boolean>("has_saved_admin_credential", { adminUpn: normalized });
    adminPasswordInput.placeholder = hasSaved
      ? "Saved password found (leave blank to reuse)"
      : "Enter admin password (saved securely)";
  } catch {
    adminPasswordInput.placeholder = "Enter admin password";
  }
}

function isIdleForCredentialForget(): boolean {
  return Date.now() - lastActivityTimestamp > CREDENTIAL_FORGET_TIMEOUT_MS;
}

async function clearSavedCredential(reason: string, errorContext: string): Promise<void> {
  try {
    await invoke("clear_saved_admin_credential");
    adminPasswordInput.value = "";
    await refreshSavedAdminCredentialHint();
    log(reason);
  } catch (error) {
    log(`${errorContext}: ${String(error)}`, true);
  }
}

async function autoForgetCredentialIfIdle(): Promise<void> {
  if (credentialAutoForgetRunning || credentialAutoForgetTriggered) return;
  if (!isIdleForCredentialForget()) return;

  const normalized = normalizeEmail(adminUpnInput.value);
  if (!normalized) {
    credentialAutoForgetTriggered = true;
    return;
  }

  credentialAutoForgetRunning = true;
  try {
    const hasSaved = await invoke<boolean>("has_saved_admin_credential", { adminUpn: normalized });
    if (!hasSaved) {
      credentialAutoForgetTriggered = true;
      await refreshSavedAdminCredentialHint();
      return;
    }

    await clearSavedCredential(
      "Auto forgot saved admin password after 10 minutes of inactivity.",
      "Cannot auto forget saved admin password"
    );
    credentialAutoForgetTriggered = true;
  } finally {
    credentialAutoForgetRunning = false;
  }
}

function loadLogHistory(): string[] {
  try {
    const raw = localStorage.getItem(LOG_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, LOG_HISTORY_MAX_LINES);
  } catch {
    return [];
  }
}

function saveLogHistory(): void {
  try {
    localStorage.setItem(LOG_HISTORY_STORAGE_KEY, JSON.stringify(logHistory.slice(0, LOG_HISTORY_MAX_LINES)));
  } catch { }
}

function loadBulkInputFromSession(): string {
  try {
    return sessionStorage.getItem(BULK_INPUT_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveBulkInputToSession(): void {
  try {
    sessionStorage.setItem(BULK_INPUT_SESSION_KEY, bulkInput.innerText);
  } catch { }
}

function clearBulkInputFromSession(): void {
  try {
    sessionStorage.removeItem(BULK_INPUT_SESSION_KEY);
  } catch { }
}

function normalizeEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (!value || !EMAIL_REGEX.test(value)) return null;
  return value;
}

function parseEmails(text: string): string[] {
  const unique = new Set<string>();
  text
    .split(/[\s,;]+/g)
    .map((token) => normalizeEmail(token))
    .filter((value): value is string => value !== null)
    .forEach((email) => unique.add(email));
  return [...unique];
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLogHistory(): void {
  historyBox.textContent = logHistory.length
    ? logHistory.join("\n")
    : "No logs history yet.";
}

function openLogHistory(): void {
  renderLogHistory();
  historyModal.classList.remove("hidden");
  historyModal.setAttribute("aria-hidden", "false");
}

function closeLogHistory(): void {
  historyModal.classList.add("hidden");
  historyModal.setAttribute("aria-hidden", "true");
}

function clearLogHistory(): void {
  logHistory.length = 0;
  saveLogHistory();
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
  saveLogHistory();
  if (error) logBox.classList.add("error");
}

function updateCounts(): void {
  addCount.textContent = String(state.add.length);
  removeCount.textContent = String(state.remove.length);
}

function renderZone(target: QueueName): void {
  const zone = target === "add" ? addZone : removeZone;
  const items = state[target]
    .map(
      (email) => `
        <li class="email-item" draggable="true" data-email="${escapeHtml(email)}" data-source="${target}">
          <span>${escapeHtml(email)}</span>
          <button class="delete-btn" data-email="${escapeHtml(email)}" data-source="${target}" title="Remove from queue">x</button>
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
  bindDynamicEvents();
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
  let removable = new Set<string>();

  if (details.length) {
    const expectedGroups = groups.length;
    const stats = new Map<string, { okGroups: Set<string>; hasFail: boolean }>();

    details.forEach((item) => {
      const email = normalizeEmail(item.email);
      const group = normalizeEmail(item.group);
      if (!email || !group) return;

      if (!stats.has(email)) {
        stats.set(email, { okGroups: new Set<string>(), hasFail: false });
      }

      const record = stats.get(email)!;
      if (normalizeStatus(item.status) === "ok") {
        record.okGroups.add(group);
      } else {
        record.hasFail = true;
      }
    });

    payload.forEach((email) => {
      const record = stats.get(email);
      if (!record) return;
      if (!record.hasFail && record.okGroups.size === expectedGroups) {
        removable.add(email);
      }
    });
  } else if (failedCount === 0) {
    removable = new Set(payload);
  }

  if (!removable.size) {
    return;
  }

  state[action] = state[action].filter((email) => !removable.has(email));
  render();
  await persistQueues();
  log(`Auto removed ${removable.size} completed email(s) from ${action.toUpperCase()} queue.`);
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
function ensureInQueue(target: QueueName, emails: string[]): void {
  const opposite: QueueName = target === "add" ? "remove" : "add";
  const nextTarget = new Set(state[target]);
  const nextOpposite = new Set(state[opposite]);
  emails.forEach((email) => {
    nextOpposite.delete(email);
    nextTarget.add(email);
  });
  state[target] = [...nextTarget].sort();
  state[opposite] = [...nextOpposite].sort();
}

function removeFromQueue(target: QueueName, email: string): void {
  state[target] = state[target].filter((item) => item !== email);
}

function moveEmail(email: string, source: QueueName, target: QueueName): void {
  if (source === target) return;
  removeFromQueue(source, email);
  ensureInQueue(target, [email]);
}

async function persistQueues(): Promise<void> {
  await invoke("save_email_queues", { add: state.add, remove: state.remove });
}

async function queueFromInput(target: QueueName): Promise<void> {
  const emails = parseEmails(bulkInput.innerText);
  if (!emails.length) {
    log("No valid emails found in the input area.", true);
    return;
  }
  ensureInQueue(target, emails);
  render();
  await persistQueues();
  log(`Queued ${emails.length} email(s) into ${target.toUpperCase()}.`);
  saveBulkInputToSession();
}

async function clearQueues(): Promise<void> {
  state.add = [];
  state.remove = [];
  bulkInput.textContent = "";
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
  const prevAdd = [...state.add];
  state.add = [...state.remove].sort();
  state.remove = prevAdd.sort();
  render();
  await persistQueues();
  log("Undo applied: swapped ADD and REMOVE queues.");
}

// ── Run action ────────────────────────────────────────────────────
async function runAction(action: QueueName): Promise<void> {
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
  const adminPassword = adminPasswordInput.value;
  if (adminPassword.trim().length > 0 && !adminUpn) {
    log("Please enter a valid admin account before saving password.", true);
    return;
  }

  const forceReconnect = isIdle();
  if (forceReconnect) {
    log("Idle for more than 5 minutes. Will re-authenticate with Microsoft.");
  }

  setBusy(true);
  showProgressIndeterminate(
    `${action === "add" ? "Adding" : "Removing"} ${payload.length} email(s) for ${groups.length} group(s)...`
  );
  showRunningLayout();

  try {
    await persistQueues();
    log("Opening Microsoft sign-in window. Complete 2FA when prompted.");

    const result = await invoke<GroupRunResult>("run_group_action", {
      action,
      emails: payload,
      groupEmails: groups,
      adminUpn: adminUpn ?? null,
      adminPassword: adminPassword.trim().length ? adminPassword : null,
      forceReconnect
    });

    log(`Done ${result.action.toUpperCase()} for ${groups.length} group(s): ${result.successCount} success, ${result.failedCount} failed.`);
    if (result.stdout) log(result.stdout);
    if (result.stderr) log(result.stderr, true);
    renderResultDetails(result.details ?? []);
    await autoRemoveCompletedEmails(action, payload, groups, result.details ?? [], result.failedCount);
    if (adminPassword.trim().length) {
      log("Admin password saved securely for this Windows user.");
    }

    showProgressDone(result.successCount, result.failedCount);
    touchActivity();
  } catch (error) {
    log(String(error), true);
    hideProgress();
  } finally {
    adminPasswordInput.value = "";
    void refreshSavedAdminCredentialHint();
    setBusy(false);
    resetLayout(true);
  }
}

function setBusy(value: boolean): void {
  [
    queueToAddBtn,
    queueToRemoveBtn,
    clearQueuesBtn,
    undoSwapBtn,
    viewLogHistoryBtn,
    runAddBtn,
    runRemoveBtn,
    groupEmailInput,
    adminUpnInput,
    adminPasswordInput
  ].forEach((el) => {
    el.disabled = value;
  });
}
function bindDynamicEvents(): void {
  document.querySelectorAll<HTMLLIElement>(".email-item").forEach((item) => {
    item.addEventListener("dragstart", (event: DragEvent) => {
      const email = item.dataset.email ?? "";
      const source = item.dataset.source ?? "";
      if (!email || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", email);
      event.dataTransfer.setData("application/x-source", source);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const email = button.dataset.email ?? "";
      const source = button.dataset.source as QueueName;
      if (!email || (source !== "add" && source !== "remove")) return;
      removeFromQueue(source, email);
      render();
      await persistQueues();
    });
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
async function initializeEmptyQueues(): Promise<void> {
  state.add = [];
  state.remove = [];
  bulkInput.textContent = loadBulkInputFromSession();
  render();
  resetLayout(false);
  try {
    await persistQueues();
  } catch (error) {
    log(`Cannot initialize empty queues: ${String(error)}`, true);
  }
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
    void refreshSavedAdminCredentialHint();
    return;
  }
  adminUpnInput.value = normalized;
  saveAdminUpn(normalized);
  void refreshSavedAdminCredentialHint();
});

bulkInput.addEventListener("input", () => {
  saveBulkInputToSession();
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
});

// ── Init ──────────────────────────────────────────────────────────
setInterval(() => {
  void autoForgetCredentialIfIdle();
}, 15000);

window.addEventListener("beforeunload", () => {
  void invoke("clear_saved_admin_credential");
});

wireDropZone(addZone, "add");
wireDropZone(removeZone, "remove");
renderLogHistory();
void initializeEmptyQueues();

