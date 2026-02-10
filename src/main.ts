import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type QueueName = "add" | "remove";
type GroupKind = "Distribution" | "M365" | "Security" | "Unknown" | "NotChecked";
type ExecutionPath = "exchange" | "graph";

interface SeedEmails {
  add: string[];
  remove: string[];
}

interface GroupRunResult {
  action: QueueName;
  processed: number;
  stdout: string;
  stderr: string;
}

interface GroupTypeResult {
  inputEmail: string;
  normalizedEmail: string;
  groupType: Exclude<GroupKind, "NotChecked">;
  rawType: string;
  displayName: string;
  primarySmtpAddress: string;
  graphAllowed: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_GROUP_EMAIL = "ASWVN_TradeUnion@aswhiteglobal.com";
const GROUP_EMAIL_STORAGE_KEY = "trade-union.group-email";

const state: Record<QueueName, string[]> = {
  add: [],
  remove: []
};

const groupState: {
  email: string;
  groupType: GroupKind;
  rawType: string;
  displayName: string;
  primarySmtpAddress: string;
  graphAllowed: boolean;
} = {
  email: loadStoredGroupEmail(),
  groupType: "NotChecked",
  rawType: "",
  displayName: "",
  primarySmtpAddress: "",
  graphAllowed: false
};

let executionPath: ExecutionPath = "exchange";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Cannot find #app root");
}

app.innerHTML = `
  <main class="canvas">
    <header class="hero">
      <h1>Trade Union Group Manager</h1>
      <p>Drag emails between 2 queues. Run Remove to delete users from the distribution group.</p>
    </header>

    <section class="group-target">
      <div class="group-head">
        <h2>Group Target</h2>
        <span id="group-type-pill" class="group-pill notchecked">Not checked</span>
      </div>

      <label for="group-email">Group email</label>
      <div class="group-row">
        <input id="group-email" type="email" placeholder="ASWVN_TradeUnion@aswhiteglobal.com" />
        <button id="check-group-type" class="btn outline">Check Group Type</button>
      </div>

      <div class="route-row">
        <label for="execution-path">Execution Path</label>
        <select id="execution-path">
          <option value="exchange">Exchange PowerShell</option>
          <option value="graph">Microsoft Graph</option>
        </select>
        <span id="graph-lock-note" class="route-note">Run group check to decide Graph availability.</span>
      </div>

      <p id="group-meta" class="group-meta">No group analyzed yet.</p>
    </section>

    <section class="composer">
      <label for="bulk-input">Paste email list (split by new lines, commas, or spaces)</label>
      <textarea id="bulk-input" placeholder="alice@company.com&#10;bob@company.com"></textarea>
      <div class="composer-actions">
        <button id="queue-to-add" class="btn solid">Queue to Add</button>
        <button id="queue-to-remove" class="btn outline">Queue to Remove</button>
        <button id="reload-files" class="btn ghost">Reload from files</button>
      </div>
    </section>

    <section class="board">
      <article class="lane">
        <div class="lane-head">
          <h2>Add Queue</h2>
          <span id="add-count" class="pill-count">0</span>
        </div>
        <p class="lane-hint">Drop here to add users to the group</p>
        <ul id="add-zone" data-list="add" class="drop-list"></ul>
        <button id="run-add" class="btn solid wide">Run Add</button>
      </article>

      <article class="lane remove">
        <div class="lane-head">
          <h2>Remove Queue</h2>
          <span id="remove-count" class="pill-count">0</span>
        </div>
        <p class="lane-hint">Drop here to remove users from the group</p>
        <ul id="remove-zone" data-list="remove" class="drop-list"></ul>
        <button id="run-remove" class="btn danger wide">Run Remove</button>
      </article>
    </section>

    <section class="activity">
      <h3>Activity Log</h3>
      <pre id="log-box"></pre>
    </section>
  </main>
`;

const bulkInput = document.querySelector<HTMLTextAreaElement>("#bulk-input")!;
const addZone = document.querySelector<HTMLUListElement>("#add-zone")!;
const removeZone = document.querySelector<HTMLUListElement>("#remove-zone")!;
const addCount = document.querySelector<HTMLSpanElement>("#add-count")!;
const removeCount = document.querySelector<HTMLSpanElement>("#remove-count")!;
const logBox = document.querySelector<HTMLPreElement>("#log-box")!;
const queueToAddBtn = document.querySelector<HTMLButtonElement>("#queue-to-add")!;
const queueToRemoveBtn = document.querySelector<HTMLButtonElement>("#queue-to-remove")!;
const reloadBtn = document.querySelector<HTMLButtonElement>("#reload-files")!;
const runAddBtn = document.querySelector<HTMLButtonElement>("#run-add")!;
const runRemoveBtn = document.querySelector<HTMLButtonElement>("#run-remove")!;
const groupEmailInput = document.querySelector<HTMLInputElement>("#group-email")!;
const checkGroupTypeBtn = document.querySelector<HTMLButtonElement>("#check-group-type")!;
const groupTypePill = document.querySelector<HTMLSpanElement>("#group-type-pill")!;
const groupMeta = document.querySelector<HTMLParagraphElement>("#group-meta")!;
const graphLockNote = document.querySelector<HTMLSpanElement>("#graph-lock-note")!;
const executionPathSelect = document.querySelector<HTMLSelectElement>("#execution-path")!;

groupEmailInput.value = groupState.email;
executionPathSelect.value = executionPath;

function loadStoredGroupEmail(): string {
  try {
    const saved = localStorage.getItem(GROUP_EMAIL_STORAGE_KEY);
    if (!saved) {
      return DEFAULT_GROUP_EMAIL;
    }
    return normalizeEmail(saved) ?? DEFAULT_GROUP_EMAIL;
  } catch {
    return DEFAULT_GROUP_EMAIL;
  }
}

function saveGroupEmail(value: string): void {
  try {
    localStorage.setItem(GROUP_EMAIL_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures
  }
}

function normalizeEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (!value || !EMAIL_REGEX.test(value)) {
    return null;
  }
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
  if (error) {
    logBox.classList.add("error");
  }
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

function groupTypeLabel(type: GroupKind): string {
  switch (type) {
    case "Distribution":
      return "Distribution";
    case "M365":
      return "M365";
    case "Security":
      return "Security";
    case "Unknown":
      return "Unknown";
    default:
      return "Not checked";
  }
}

function groupTypeClass(type: GroupKind): string {
  switch (type) {
    case "Distribution":
      return "distribution";
    case "M365":
      return "m365";
    case "Security":
      return "security";
    case "Unknown":
      return "unknown";
    default:
      return "notchecked";
  }
}

function isGraphLocked(): boolean {
  if (groupState.groupType === "Distribution") {
    return true;
  }
  if (groupState.groupType === "NotChecked") {
    return true;
  }
  if (groupState.groupType === "Unknown") {
    return true;
  }
  return !groupState.graphAllowed;
}

function renderGroupStatus(customMeta?: string): void {
  groupTypePill.textContent = groupTypeLabel(groupState.groupType);
  groupTypePill.className = `group-pill ${groupTypeClass(groupState.groupType)}`;

  const graphOption = executionPathSelect.querySelector<HTMLOptionElement>('option[value="graph"]');
  const locked = isGraphLocked();
  if (graphOption) {
    graphOption.disabled = locked;
  }

  if (locked) {
    if (executionPath === "graph") {
      executionPath = "exchange";
      executionPathSelect.value = "exchange";
      log("Graph flow was locked. Switched execution path back to Exchange.");
    }
    graphLockNote.textContent =
      groupState.groupType === "Distribution"
        ? "Graph flow locked: Distribution groups must use Exchange."
        : "Graph flow locked: run a valid group check result first.";
    graphLockNote.classList.add("locked");
  } else {
    graphLockNote.textContent = "Graph flow available for this group type.";
    graphLockNote.classList.remove("locked");
  }

  if (customMeta) {
    groupMeta.textContent = customMeta;
    return;
  }

  if (groupState.groupType === "NotChecked") {
    groupMeta.textContent = "Enter group email and click Check Group Type.";
    return;
  }

  if (groupState.groupType === "Unknown") {
    groupMeta.textContent = "Group type unknown. Graph stays locked for safety.";
    return;
  }

  const details: string[] = [];
  if (groupState.displayName) {
    details.push(`Name: ${groupState.displayName}`);
  }
  if (groupState.primarySmtpAddress) {
    details.push(`Primary SMTP: ${groupState.primarySmtpAddress}`);
  }
  if (groupState.rawType) {
    details.push(`Raw type: ${groupState.rawType}`);
  }

  groupMeta.textContent = details.join(" | ");
}

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
  if (source === target) {
    return;
  }
  removeFromQueue(source, email);
  ensureInQueue(target, [email]);
}

async function persistQueues(): Promise<void> {
  await invoke("save_email_queues", {
    add: state.add,
    remove: state.remove
  });
}

async function queueFromInput(target: QueueName): Promise<void> {
  const emails = parseEmails(bulkInput.value);
  if (!emails.length) {
    log("No valid emails found in the input area.", true);
    return;
  }

  ensureInQueue(target, emails);
  render();
  await persistQueues();
  log(`Queued ${emails.length} email(s) into ${target.toUpperCase()}.`);
  bulkInput.value = "";
}

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

  groupState.email = normalizedGroup;
  saveGroupEmail(normalizedGroup);

  if (executionPath === "graph") {
    if (isGraphLocked()) {
      log("Graph flow is locked for this group type.", true);
      return;
    }
    log("Graph execution path is not implemented yet. Switch to Exchange for now.", true);
    return;
  }

  setBusy(true);
  try {
    await persistQueues();
    const result = await invoke<GroupRunResult>("run_group_action", {
      action,
      emails: payload,
      groupEmail: normalizedGroup
    });

    log(`Done ${result.action.toUpperCase()}: ${result.processed} email(s).`);
    if (result.stdout) {
      log(result.stdout);
    }
    if (result.stderr) {
      log(result.stderr, true);
    }

    state[action] = [];
    render();
    await persistQueues();
    await loadSeedEmails();
  } catch (error) {
    log(String(error), true);
  } finally {
    setBusy(false);
  }
}

function setBusy(value: boolean): void {
  [
    queueToAddBtn,
    queueToRemoveBtn,
    reloadBtn,
    runAddBtn,
    runRemoveBtn,
    checkGroupTypeBtn,
    groupEmailInput,
    executionPathSelect
  ].forEach((button) => {
    button.disabled = value;
  });
}

function bindDynamicEvents(): void {
  document.querySelectorAll<HTMLLIElement>(".email-item").forEach((item) => {
    item.addEventListener("dragstart", (event: DragEvent) => {
      const email = item.dataset.email ?? "";
      const source = item.dataset.source ?? "";
      if (!email || !event.dataTransfer) {
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", email);
      event.dataTransfer.setData("application/x-source", source);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const email = button.dataset.email ?? "";
      const source = button.dataset.source as QueueName;
      if (!email || (source !== "add" && source !== "remove")) {
        return;
      }
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
    if (!email || !source) {
      return;
    }

    moveEmail(email, source, target);
    render();
    await persistQueues();
  });
}

async function loadSeedEmails(): Promise<void> {
  try {
    const result = await invoke<SeedEmails>("load_seed_emails");
    const addSet = new Set(
      result.add
        .map((item) => normalizeEmail(item))
        .filter((value): value is string => value !== null)
    );
    const removeSet = new Set(
      result.remove
        .map((item) => normalizeEmail(item))
        .filter((value): value is string => value !== null)
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

async function checkGroupType(): Promise<void> {
  const normalized = normalizeEmail(groupEmailInput.value);
  if (!normalized) {
    log("Please provide a valid group email before checking type.", true);
    return;
  }

  groupEmailInput.value = normalized;
  groupState.email = normalized;
  saveGroupEmail(normalized);

  setBusy(true);
  try {
    const result = await invoke<GroupTypeResult>("check_group_type", {
      groupEmail: normalized
    });

    groupState.email = result.normalizedEmail;
    groupState.groupType = result.groupType;
    groupState.rawType = result.rawType;
    groupState.displayName = result.displayName;
    groupState.primarySmtpAddress = result.primarySmtpAddress;
    groupState.graphAllowed = result.graphAllowed;

    groupEmailInput.value = result.normalizedEmail;
    saveGroupEmail(result.normalizedEmail);
    renderGroupStatus();

    log(
      `Group type checked: ${result.groupType} (${result.rawType || "no raw type"}) for ${result.normalizedEmail}.`
    );
  } catch (error) {
    groupState.groupType = "Unknown";
    groupState.rawType = "";
    groupState.displayName = "";
    groupState.primarySmtpAddress = "";
    groupState.graphAllowed = false;
    renderGroupStatus(`Check failed: ${String(error)}`);
    log(`Check Group Type failed: ${String(error)}`, true);
  } finally {
    setBusy(false);
  }
}

queueToAddBtn.addEventListener("click", () => {
  void queueFromInput("add");
});

queueToRemoveBtn.addEventListener("click", () => {
  void queueFromInput("remove");
});

reloadBtn.addEventListener("click", () => {
  void loadSeedEmails();
});

runAddBtn.addEventListener("click", () => {
  void runAction("add");
});

runRemoveBtn.addEventListener("click", () => {
  void runAction("remove");
});

checkGroupTypeBtn.addEventListener("click", () => {
  void checkGroupType();
});

executionPathSelect.addEventListener("change", () => {
  const selected = executionPathSelect.value === "graph" ? "graph" : "exchange";
  if (selected === "graph" && isGraphLocked()) {
    executionPath = "exchange";
    executionPathSelect.value = "exchange";
    log("Graph path is locked for current group type.", true);
    return;
  }

  executionPath = selected;
  log(`Execution path set to ${executionPath.toUpperCase()}.`);
});

groupEmailInput.addEventListener("change", () => {
  const normalized = normalizeEmail(groupEmailInput.value);
  if (!normalized) {
    groupState.groupType = "NotChecked";
    groupState.rawType = "";
    groupState.displayName = "";
    groupState.primarySmtpAddress = "";
    groupState.graphAllowed = false;
    renderGroupStatus("Please enter a valid group email and re-check.");
    return;
  }

  if (normalized !== groupState.email) {
    groupState.email = normalized;
    saveGroupEmail(normalized);
    groupState.groupType = "NotChecked";
    groupState.rawType = "";
    groupState.displayName = "";
    groupState.primarySmtpAddress = "";
    groupState.graphAllowed = false;
    groupEmailInput.value = normalized;
    renderGroupStatus("Group email changed. Run Check Group Type again.");
  }
});

wireDropZone(addZone, "add");
wireDropZone(removeZone, "remove");
renderGroupStatus();
void loadSeedEmails();
