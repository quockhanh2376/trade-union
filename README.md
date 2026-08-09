# Trade Union Group Manager

A Windows desktop app (Tauri v2) for managing members of Exchange Online
Distribution Groups via two drag-and-drop queues (Add / Remove).

**Version:** 2.0.5 · **Identifier:** `com.aswhite.tradeunion`

## Features

- Paste a list of email addresses, then add them to or remove them from one or
  more Exchange Online distribution groups.
- Two drag-and-drop queues — **Add** and **Remove** — with live email count,
  deduplication, sorting, and validation.
- Supports multiple groups per run (comma-separated), processed sequentially
  in the order entered.
- Queues are persisted across app restarts.
- Bundled offline `ExchangeOnlineManagement` PowerShell module — no internet
  install required on first run.
- Modern auth (MFA) via Microsoft sign-in prompt. No passwords stored.
- Content Security Policy enabled; PowerShell actions have a 15-minute timeout.

## Requirements

| Component | Why |
|-----------|-----|
| Windows 10/11 (x64) | Tauri webview + PowerShell + ExchangeOnlineManagement |
| WebView2 Runtime | Bundled offline installer if not already present |
| PowerShell 5.1 or 7+ | Exchange Online automation (auto-detected, prefers `pwsh.exe`) |
| Exchange admin permissions | The signed-in admin must have rights to manage the target groups |

No Python or external CLI is required — the legacy Python scripts have been
removed.

## Development setup

### Prerequisites

- [Node.js](https://nodejs.org/) LTS (v20+ recommended; v22 tested)
- [Rust](https://www.rust-lang.org/tools/install) stable toolchain
- Visual Studio Build Tools (Desktop C++ workload)

### Install & run

```powershell
npm install
npm run tauri dev
```

The Vite dev server starts on `http://localhost:1420` and the Tauri window
opens automatically. First launch may take 1–3 minutes to compile Rust.

### Build a production installer

```powershell
npm run tauri build
```

Outputs an NSIS `.exe` and a WiX `.msi` under
`src-tauri/target/release/bundle/`.

## Usage

1. **Group email** — enter one or more distribution group addresses
   (comma-separated, e.g. `group1@company.com, group2@company.com`).
2. **Admin UPN** *(optional)* — enter the admin account email to pre-select it
   in the Microsoft sign-in prompt. If left blank, you choose the account
   interactively.
3. **Email List** — paste a list of email addresses (newline / comma /
   semicolon separated). Invalid entries are ignored; valid ones are
   normalised to lowercase, deduplicated, and sorted.
4. Click **Add** to queue emails into the Add lane, or **Remove** for the
   Remove lane. Emails can be dragged between lanes at any time.
5. Click **▶ Run** under either lane. The app opens a Microsoft sign-in
   window (MFA supported), then adds or removes each email from every
   targeted group via `manage_distribution_group.ps1`.
6. On success, completed emails are automatically removed from the queue.
   Current group members are exported to `final.txt` in the app data
   directory.

> While a run is active, all queue mutations (Add / Remove / Clear / Undo /
> drag / delete) are blocked until the run finishes or times out.

## Architecture

```
Frontend (TypeScript + Vite)
  ├── main.ts        UI template, event handlers, queue orchestration
  ├── queue.ts       queue state + mutations (add/remove/move)
  ├── email.ts       normalize / parse / validate emails
  ├── queue-startup.ts    load persisted queues at startup (F-02)
  ├── queue-mutation-guard.ts  busy/load-failed guards (F-07/F-08)
  └── run-reconciliation.ts    auto-remove completed emails (F-03)
        │
        │  invoke() — Tauri IPC
        ▼
Backend (Rust / Tauri v2)
  ├── main.rs        3 commands: load_seed_emails, save_email_queues,
  │                  run_group_action (with 15-min timeout, F-06)
  └── scripts/
       ├── common.ps1                    shared helpers (F-10)
       ├── manage_distribution_group.ps1  Add/Remove members + export
       └── detect_group_type.ps1          standalone group-type probe
```

The frontend never touches files or Exchange directly; all operations go
through Tauri commands, which shell out to PowerShell with the bundled
`ExchangeOnlineManagement` module.

## Testing

```powershell
# Frontend type-check + production build
npm run build

# Node tests (contract + behavioral)
node --test tests/clear-bulk-input-ui.test.mjs tests/exchange-module-bundle.test.mjs tests/installer-clean-upgrade.test.mjs tests/csp-config.test.mjs
node --experimental-strip-types --test tests/email.test.mjs tests/queue.test.mjs tests/run-reconciliation.test.mjs tests/queue-startup.test.mjs tests/queue-mutation-guard.test.mjs

# Rust tests (hard-constraint invariants)
cargo test --manifest-path src-tauri/Cargo.toml

# PowerShell syntax check
powershell -NoProfile -Command "foreach ($f in @('common','manage_distribution_group','detect_group_type')) { $null = [System.Management.Automation.Language.Parser]::ParseFile(\"$PWD/src-tauri/scripts/$f.ps1\", [ref]$null, [ref]$null) }"
```

There is no `npm test` script — invoke the test runners directly as above.

## Security notes

- **CSP enabled** — `default-src 'self'`, no `unsafe-eval`, no wildcards (F-09).
- **Modern auth only** — no password credentials; admin identity flows through
  `-AdminUpn` / `UserPrincipalName` with MFA.
- **PowerShell timeout** — actions are killed after 15 minutes to prevent UI
  hangs (F-06).
- **Queue race guards** — mutations are blocked while a run is active (F-07/F-08).
- No credentials, tokens, or secrets are committed to the repository.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `TRADE_UNION_GROUP` | Override the default distribution group email. |
| `TRADE_UNION_ROOT` | Override the workspace root (used to locate dev `scripts/` and `vendor/` instead of bundled resources). |

## Troubleshooting

- **First run is slow** — Rust debug compilation takes 1–3 minutes. Subsequent
  launches use incremental builds (~10–30 s).
- **Microsoft sign-in window doesn't appear** — WAM is disabled so the browser
  flow can open; ensure no other hidden PowerShell process is blocking.
- **Exchange module not found** — the app bundles `ExchangeOnlineManagement`
  3.9.2 offline. If the bundled path is unavailable it falls back to
  `Install-Module` from PSGallery.
- **Queues are empty after restart** — if the persisted state failed to load,
  the UI enters read-only mode. Restart the app to retry.

## Legacy

The legacy Python CLI (`cli.py`, `trade_union.py`, `test_trade_union.py`) and
the standalone script `AddEmailsToDistList.ps1` were removed in v2.0.5. They
were superseded by the Tauri app and `manage_distribution_group.ps1`.
