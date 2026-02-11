import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type QueueName = "add" | "remove";

interface SeedEmails {
  add: string[];
  remove: string[];
}

interface GroupRunResult {
  action: string;
  processed: number;
  successCount: number;
  failedCount: number;
  stdout: string;
  stderr: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_GROUP_EMAIL = "ASWVN_TradeUnion@aswhiteglobal.com";
const GROUP_EMAIL_STORAGE_KEY = "trade-union.group-email";
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const state: Record<QueueName, string[]> = {
  add: [],
  remove: []
};

let lastActivityTimestamp = Date.now();

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Cannot find #app root");
}

app.innerHTML = `
  <main class="canvas">
    <header class="hero">
      <div class="hero-top">
        <h1>Trade Union Group Manager</h1>
        <div class="group-email-inline">
          <label for="group-email">Group:</label>
          <input id="group-email" type="email" placeholder="ASWVN_TradeUnion@aswhiteglobal.com" />
        </div>
      </div>
      <p>Drag emails between 2 queues. Run Remove to delete users from the distribution group.</p>
    </header>

    <section class="composer">
      <label for="bulk-input">Paste email list (split by new lines, commas, or spaces)</label>
      <div id="bulk-input" class="bulk-editable" contenteditable="true" data-placeholder="alice@company.com&#10;bob@company.com"></div>
      <div class="composer-actions">
        <button id="queue-to-add" class="btn solid">Queue to Add</button>
        <span id="add-count" class="pill-count">0</span>
        <button id="queue-to-remove" class="btn outline">Queue to Remove</button>
        <span id="remove-count" class="pill-count pill-remove">0</span>
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

    <section class="activity" id="activity">
      <h3>Activity Log</h3>
      <pre id="log-box"></pre>
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
const runAddBtn = document.querySelector<HTMLButtonElement>("#run-add")!;
const runRemoveBtn = document.querySelector<HTMLButtonElement>("#run-remove")!;
const groupEmailInput = document.querySelector<HTMLInputElement>("#group-email")!;
const progressSection = document.querySelector<HTMLElement>("#progress-section")!;
const progressLabel = document.querySelector<HTMLSpanElement>("#progress-label")!;
const progressPercent = document.querySelector<HTMLSpanElement>("#progress-percent")!;
const progressFill = document.querySelector<HTMLDivElement>("#progress-fill")!;
const resultSuccess = document.querySelector<HTMLSpanElement>("#result-success")!;
const resultFail = document.querySelector<HTMLSpanElement>("#result-fail")!;
const boardSection = document.querySelector<HTMLElement>("#board")!;
const activitySection = document.querySelector<HTMLElement>("#activity")!;

groupEmailInput.value = loadStoredGroupEmail();

// ── Activity tracking ─────────────────────────────────────────────
function touchActivity(): void {
  lastActivityTimestamp = Date.now();
}

function isIdle(): boolean {
  return Date.now() - lastActivityTimestamp > IDLE_TIMEOUT_MS;
}

document.addEventListener("click", touchActivity);
document.addEventListener("keydown", touchActivity);
document.addEventListener("dragstart", touchActivity);

// ── Helpers ───────────────────────────────────────────────────────
function loadStoredGroupEmail(): string {
  try {
    const saved = localStorage.getItem(GROUP_EMAIL_STORAGE_KEY);
    if (!saved) return DEFAULT_GROUP_EMAIL;
    return normalizeEmail(saved) ?? DEFAULT_GROUP_EMAIL;
  } catch {
    return DEFAULT_GROUP_EMAIL;
  }
}

function saveGroupEmail(value: string): void {
  try { localStorage.setItem(GROUP_EMAIL_STORAGE_KEY, value); } catch { }
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

function log(message: string, error = false): void {
  const stamp = new Date().toLocaleTimeString();
  const line = `[${stamp}] ${message}`;
  logBox.textContent = `${line}\n${logBox.textContent ?? ""}`.trim();
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
  bulkInput.textContent = "";
}

// ── Run action ────────────────────────────────────────────────────
async function runAction(action: QueueName): Promise<void> {
  const payload = [...state[action]];
  if (!payload.length) {
    log(`Queue ${action.toUpperCase()} is empty.`, true);
    return;
  }

  const normalizedGroup = normalizeEmail(groupEmailInput.value);
  if (!normalizedGroup) {
    log("Please enter a valid group email before running actions.", true);
    return;
  }

  saveGroupEmail(normalizedGroup);

  const forceReconnect = isIdle();
  if (forceReconnect) {
    log("Idle for more than 5 minutes. Will re-authenticate with Microsoft.");
  }

  setBusy(true);
  showProgressIndeterminate(`${action === "add" ? "Adding" : "Removing"} ${payload.length} email(s)…`);

  // Collapse email lists only, keep headers + run buttons visible
  document.querySelectorAll(".drop-list").forEach(el => el.classList.add("collapsed"));
  document.querySelectorAll(".lane-hint").forEach(el => (el as HTMLElement).style.display = "none");
  document.querySelectorAll(".lane").forEach(el => el.classList.add("compact"));
  activitySection.classList.add("expanded");

  try {
    await persistQueues();

    const result = await invoke<GroupRunResult>("run_group_action", {
      action,
      emails: payload,
      groupEmail: normalizedGroup,
      forceReconnect
    });

    log(`Done ${result.action.toUpperCase()}: ${result.successCount} success, ${result.failedCount} failed.`);
    if (result.stdout) log(result.stdout);
    if (result.stderr) log(result.stderr, true);

    showProgressDone(result.successCount, result.failedCount);

    state[action] = [];
    render();
    await persistQueues();
    await loadSeedEmails();
    touchActivity();
  } catch (error) {
    log(String(error), true);
    hideProgress();
  } finally {
    setBusy(false);
  }
}

function setBusy(value: boolean): void {
  [queueToAddBtn, queueToRemoveBtn, runAddBtn, runRemoveBtn, groupEmailInput].forEach((el) => {
    el.disabled = value;
  });
}

// ── Drag & Drop ───────────────────────────────────────────────────
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
async function loadSeedEmails(): Promise<void> {
  try {
    const result = await invoke<SeedEmails>("load_seed_emails");
    const addSet = new Set(
      result.add.map((i) => normalizeEmail(i)).filter((v): v is string => v !== null)
    );
    const removeSet = new Set(
      result.remove.map((i) => normalizeEmail(i)).filter((v): v is string => v !== null)
    );
    removeSet.forEach((email) => addSet.delete(email));
    state.add = [...addSet].sort();
    state.remove = [...removeSet].sort();
    render();
    log("Loaded queues from emails.txt + removeemail.txt.");
  } catch (error) {
    log(`Cannot load queue files: ${String(error)}`, true);
  }
}

// ── Event listeners ───────────────────────────────────────────────
queueToAddBtn.addEventListener("click", () => void queueFromInput("add"));
queueToRemoveBtn.addEventListener("click", () => void queueFromInput("remove"));
runAddBtn.addEventListener("click", () => void runAction("add"));
runRemoveBtn.addEventListener("click", () => void runAction("remove"));

groupEmailInput.addEventListener("change", () => {
  const normalized = normalizeEmail(groupEmailInput.value);
  if (normalized) {
    groupEmailInput.value = normalized;
    saveGroupEmail(normalized);
  }
});

// ── Init ──────────────────────────────────────────────────────────
wireDropZone(addZone, "add");
wireDropZone(removeZone, "remove");
void loadSeedEmails();
