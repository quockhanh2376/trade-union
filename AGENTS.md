# AGENTS.md

Guidance for ZCode agents working in this repository.

## What this is

**Trade Union Group Manager** — a Tauri v2 desktop app (Windows-focused) that manages
members of Exchange Online **Distribution Groups** via two drag-and-drop queues
(Add / Remove) and provides self-service password management via Microsoft Graph.
Product identifier: `com.aswhite.tradeunion`. Current version: **2.0.8**.

## Architecture (three layers — keep them separate)

1. **Frontend** — vanilla TypeScript + Vite, *no framework*. UI is a single template
   string in `src/main.ts`; logic split into modules under `src/`:
   `main.ts` (UI + orchestration), `queue.ts` (queue state), `email.ts`
   (normalize/validate), `storage.ts` (localStorage/sessionStorage),
   `auth.ts` (in-memory auth-session cache), `constants.ts`, `types.ts`, `style.css`.
   Talks to the backend only via `invoke()` from `@tauri-apps/api/core`.
2. **Backend** — Rust, single crate in `src-tauri/src/main.rs`. Exposes five
   `#[tauri::command]`s: `load_seed_emails`, `save_email_queues`, `run_group_action`,
   `export_group_members`, `change_user_password`.
   `run_group_action` and `export_group_members` shell out to PowerShell via `hidden_powershell_command()`.
3. **PowerShell** — `src-tauri/scripts/*.ps1` drive Exchange Online
   (`manage_distribution_group.ps1` via `ExchangeOnlineManagement`) and Microsoft Graph
   (`change_password.ps1` via `Microsoft.Graph.Users`). Exchange modules are bundled offline
   under `src-tauri/vendor/powershell-modules/` so no internet install is required.
   Microsoft.Graph.Users is NOT bundled; change_password.ps1 installs it at runtime pinned to `$GraphModuleVersion` — bump the pin by editing that variable.

**Layer rule:** frontend never touches files or Exchange directly; Rust never
reaches into the DOM; PowerShell never imports app code. Frontend ↔ Rust contract
is the set of `invoke`d command names.

## Agent Guidelines: Ponytail & Superpowers Core Rules

All agents working in this repository MUST adhere to these two golden methodologies:

### 1. Ponytail Principles (Anti Over-Engineering & Minimalism)
- **"The best code is the code you never wrote" (YAGNI)**: Question whether new code needs to exist at all.
- **The Decision Ladder**: Before writing code or adding complexity:
  1. Does the feature/refactor really need to exist?
  2. Does the codebase already have a helper or pattern for it (e.g. `common.ps1`, `src/email.ts`)?
  3. Can the standard library (`std`) or native platform built-in handle it?
  4. Can it be written in the smallest, clearest contiguous change without extra abstraction?
- **Minimal Change Rule**: Make the smallest change sufficient to solve the problem. Do not add speculative options, wrappers, or dead code. Actively remove obsolete code.

### 2. Superpowers Principles (Plan-driven, Strict Checkpoints & TDD)
- **Plan-Driven Execution**: Break complex problems into sequential phases with explicit checklist items (`- [ ]`) before modifying code.
- **Strict Verification Checkpoints**: After EVERY phase, verify all 3 gates and report real command outputs:
  1. `node --test tests/*.test.mjs`
  2. `cargo test --manifest-path src-tauri/Cargo.toml`
  3. `npm run build`
- **TDD & Behavioral Invariant Guard**: Always protect changes with test assertions. When modifying UI/Rust/PowerShell contracts, update matching source-string assertions in `tests/*.test.mjs` and Rust tests simultaneously.

## Commands

```bash
# Frontend dev server (port 1420, strictPort)
npm run dev
# Full app (frontend + Rust) — primary dev loop
npm run tauri dev

# Typecheck + production build of frontend (tsc --noEmit + vite build)
npm run build
# Final packaging (also runs npm run build via beforeBuildCommand)
npm run tauri -- build

# Rust
cargo check  --manifest-path src-tauri/Cargo.toml
cargo test   --manifest-path src-tauri/Cargo.toml

# Node source-string tests (use exact wildcard pattern — 'tests/' fails on Node 24)
node --test tests/*.test.mjs

# Legacy Python (not the active product)
python -m unittest test_trade_union.py
```

There is **no `npm test` script** — invoke the test runners directly as above.

## Conventions that matter for edits

- **Keep versions in sync** across `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json` when bumping a release. See `RELEASE_CHECKLIST_v1.1.0.md`.
- **Emails are normalized to lowercase, deduped, and regex-validated.** This is
  implemented in *all three* layers (`normalizeEmail` in `src/email.ts`,
  `normalize_email` / `sanitize_email_input` in `main.rs`, `Test-ValidEmail` in `manage_distribution_group.ps1`)
  — change all three together.
- **Tauri command arg casing:** frontend calls with camelCase (`groupEmails`,
  `adminUpn`, `forceReconnect`); Rust params are snake_case (`group_emails`,
  `admin_upn`). Tauri converts automatically — keep the pairing.
- **Bundle new scripts/modules** by adding them to `bundle.resources` in
  `tauri.conf.json` and resolving them in Rust via `BaseDirectory::Resource`
  (see `resolve_resource`).

## Hard constraints (enforced by `cargo test`)

These Rust tests in `main.rs` will fail the build if you break them:

- **Exchange auth must be modern auth, never password credentials.** Scripts must
  not call `Connect-ExchangeOnline -Credential`; admin identity flows through
  `-AdminUpn` / `UserPrincipalName`.
- **Disable WAM** in every script that calls `Connect-ExchangeOnline`. PowerShell
  runs hidden (`CREATE_NO_WINDOW`); WAM would block the Microsoft sign-in UI.
  Connect via splatted params, not `Connect-ExchangeOnline -ShowBanner:$false`.
- **Strip Windows verbatim path prefixes** (`\\?\`, `\\?\UNC\`) with
  `powershell_compatible_path()` before passing any path to PowerShell.
- **Bundled module path uses the platform separator** (`[System.IO.Path]::PathSeparator`),
  never a hard-coded `;`.

## Tests are source-string assertions — gotcha

`tests/*.test.mjs` are **regex assertions against source text** of `main.ts`,
`main.rs`, `style.css`, `tauri.conf.json`, and the `.ps1` scripts — not behavioral
tests. They pin button labels (`Add` / `Remove` / `▶ Run`), element IDs
(`#clear-bulk-input`), CSS classes, function signatures, and arg names.

When you change those surfaces, **also update the matching assertion** in the
`.test.mjs` files, or `node --test tests/*.test.mjs` will fail. Run it after UI/structural
edits.

## Windows installer invariants

- **WiX `upgradeCode` `142d4337-ebfa-5a2e-a5f7-33592dce26d6` is the stable identity**
  across releases — do not change it.
- **NSIS uses `installer-hooks/clean-install.nsh`** (`NSIS_HOOK_PREINSTALL`) to
  remove previous installs before copying the new one. It must **not** delete user
  app data (`$APPDATA` / `$LOCALAPPDATA`) — an installer test enforces this.

## Runtime data & env overrides

- Queue/seed files (`emails.txt`, `removeemail.txt`, `final.txt`) are **sensitive
  and gitignored**. At runtime they live in the OS **app data dir**, seeded on
  startup via `load_seed_emails`.
- `TRADE_UNION_ROOT` — override workspace root (used to locate dev `scripts/` and
  `vendor/` instead of bundled resources).
- `TRADE_UNION_GROUP` — override the default distribution group email.
- PowerShell **7 (`pwsh.exe`) is preferred** over Windows PowerShell 5.1; the Rust
  launcher auto-detects and falls back.

## Docs to read before sensitive changes

- `project_analysis.md` — architecture overview (Vietnamese) + folder map.
- `RELEASE_CHECKLIST_v1.1.0.md` — release/version-sync procedure.
- `docs/superpowers/plans/` — historical design notes (e.g. hiding the PowerShell window).
- `RELEASE_NOTES_*.md` — per-version changes; latest is `v2.0.8`.
