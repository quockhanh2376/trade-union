# Hide PowerShell Window Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing Exchange Online PowerShell flow, but run it without showing a PowerShell console window while streaming output back to the app.

**Architecture:** The Tauri backend should spawn `powershell.exe` with Windows `CREATE_NO_WINDOW`, pipe `stdout` and `stderr`, and preserve the current Microsoft sign-in behavior from `Connect-ExchangeOnline`. The frontend should show progress and errors from captured output instead of relying on the console window.

**Tech Stack:** Tauri, Rust `std::process::Command`, Windows `std::os::windows::process::CommandExt`, ExchangeOnlineManagement PowerShell module.

---

## Context

The current workspace only tracks the Python files (`trade_union.py`, `cli.py`, `test_trade_union.py`). The Tauri source files are not tracked in this checkout; only generated artifacts exist under `src-tauri/target`. Before implementation, restore or add the actual Tauri source files that generated:

- `src-tauri/src/main.rs`
- `src-tauri/scripts/manage_distribution_group.ps1`
- `src-tauri/scripts/detect_group_type.ps1`
- `src-tauri/tauri.conf.json`
- frontend files under `src/` or equivalent

The artifact scripts show the current behavior:

- `manage_distribution_group.ps1` installs/imports `ExchangeOnlineManagement`, calls `Connect-ExchangeOnline`, then runs `Add-DistributionGroupMember` or `Remove-DistributionGroupMember`.
- `detect_group_type.ps1` also calls `Connect-ExchangeOnline`.
- The implementation must not switch to Microsoft Graph.

## File Structure

- Modify: `src-tauri/src/main.rs`
  - Owns Tauri commands and PowerShell process spawning.
  - Add a helper that creates a hidden PowerShell command with piped output.
- Modify: `src-tauri/scripts/manage_distribution_group.ps1`
  - Keep behavior, but make prompts safer for hidden execution.
  - Ensure module install is non-interactive or fails clearly.
- Modify: `src-tauri/scripts/detect_group_type.ps1`
  - Apply the same non-interactive module-install hardening if this script remains in use.
- Modify: `src-tauri/tauri.conf.json`
  - Set `bundle.windows.webviewInstallMode.type` to `offlineInstaller`.
- Modify/Test: existing Rust tests or add tests under `src-tauri/src/` if the app already has a test module.
  - Test command construction where possible without requiring Exchange credentials.

## Chunk 1: Restore Source and Baseline

### Task 1: Confirm Tauri Source Is Present

**Files:**
- Verify: `src-tauri/src/main.rs`
- Verify: `src-tauri/tauri.conf.json`
- Verify: `src-tauri/scripts/manage_distribution_group.ps1`

- [ ] **Step 1: Check source files**

Run:

```powershell
Test-Path src-tauri\src\main.rs
Test-Path src-tauri\tauri.conf.json
Test-Path src-tauri\scripts\manage_distribution_group.ps1
```

Expected: all three commands return `True`.

- [ ] **Step 2: If files are missing, restore source before code changes**

Use the repository or source backup that produced the current `src-tauri/target` artifacts. Do not edit generated files under `src-tauri/target` as the primary fix.

- [ ] **Step 3: Run baseline tests/build**

Run the project-appropriate checks after source is restored:

```powershell
npm run build
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: existing baseline passes, or failures are documented before starting the change.

## Chunk 2: Hidden PowerShell Spawn

### Task 2: Add a Hidden PowerShell Runner

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Locate the current PowerShell spawn code**

Search:

```powershell
rg -n "powershell|pwsh|manage_distribution_group|detect_group_type|Command::new" src-tauri\src
```

Expected: find the Tauri command(s) that run add/remove email and group detection.

- [ ] **Step 2: Extract command creation into a helper**

Add a Windows-specific helper near the existing command code:

```rust
#[cfg(windows)]
fn hidden_powershell_command() -> std::process::Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut command = std::process::Command::new("powershell.exe");
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    command
}
```

Do not add `-NonInteractive`, because `Connect-ExchangeOnline` may need an interactive browser/device authentication flow.

- [ ] **Step 3: Use the helper for add/remove email**

Replace direct `Command::new("powershell.exe")` construction for `manage_distribution_group.ps1` with `hidden_powershell_command()`, then append:

```rust
command
    .arg("-File")
    .arg(script_path)
    .arg("-Action")
    .arg(action)
    .arg("-DistGroups")
    .arg(dist_groups)
    .arg("-InputFile")
    .arg(input_file)
    .arg("-OutputFile")
    .arg(output_file);
```

Preserve any existing `AdminUpn` and `ForceReconnect` arguments.

- [ ] **Step 4: Capture output and keep current result parsing**

Use `.output()` or the app's existing async process wrapper. Continue parsing `RESULT_JSON:` from stdout. If stderr is non-empty on failure, include it in the Tauri command error returned to the frontend.

- [ ] **Step 5: Apply the same hidden runner to group detection**

If `detect_group_type.ps1` is spawned by Rust, use the same helper there too.

## Chunk 3: PowerShell Script Hardening

### Task 3: Make Hidden Execution Safe

**Files:**
- Modify: `src-tauri/scripts/manage_distribution_group.ps1`
- Modify: `src-tauri/scripts/detect_group_type.ps1`

- [ ] **Step 1: Check for prompts that would be hidden**

Search:

```powershell
rg -n "Read-Host|Install-Module|Confirm|Prompt|Pause" src-tauri\scripts
```

Expected: no `Read-Host` or `Pause`. `Install-Module` must be handled deliberately.

- [ ] **Step 2: Make module installation explicit**

Keep automatic install only if it is non-interactive. Prefer:

```powershell
Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber -Confirm:$false -ErrorAction Stop
```

If repository policy changes are not acceptable, remove auto-install and return a clear error telling the user/admin to install `ExchangeOnlineManagement` before using add/remove email.

- [ ] **Step 3: Keep auth visible**

Leave `Connect-ExchangeOnline` unchanged unless the existing app passes `AdminUpn`. The Microsoft sign-in window/browser should still appear, while the PowerShell console stays hidden.

## Chunk 4: WebView2 Offline Installer

### Task 4: Set WebView2 Install Mode

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update Tauri config**

Set:

```json
{
  "bundle": {
    "windows": {
      "webviewInstallMode": {
        "type": "offlineInstaller"
      }
    }
  }
}
```

Preserve existing `bundle.windows` settings.

- [ ] **Step 2: Build installer**

Run:

```powershell
npm run tauri:build
```

Expected: Windows installer is produced and includes WebView2 offline installer. Installer size should increase substantially compared with the bootstrapper build.

## Chunk 5: Verification

### Task 5: Validate UX and Behavior

**Files:**
- Verify built installer under `src-tauri/target/release/bundle/`

- [ ] **Step 1: Run Rust checks**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```powershell
npm run build
```

Expected: build passes.

- [ ] **Step 3: Run Tauri build**

Run:

```powershell
npm run tauri:build
```

Expected: build passes.

- [ ] **Step 4: Manual auth smoke test**

On a Windows machine with an Exchange admin account:

1. Launch the app.
2. Trigger add email.
3. Confirm no PowerShell console appears.
4. Confirm Microsoft sign-in still appears when auth is required.
5. Complete sign-in.
6. Confirm add results appear in the app and `RESULT_JSON` is parsed.
7. Repeat for remove email.

- [ ] **Step 5: Missing module smoke test**

On a clean user profile or VM without `ExchangeOnlineManagement`:

1. Trigger add email.
2. Confirm the app does not hang behind a hidden PowerShell prompt.
3. Confirm either module installs silently or the app shows a clear actionable error.

- [ ] **Step 6: Commit**

After verification:

```powershell
git add src-tauri\src\main.rs src-tauri\scripts\manage_distribution_group.ps1 src-tauri\scripts\detect_group_type.ps1 src-tauri\tauri.conf.json
git commit -m "fix: hide exchange powershell execution window"
```

