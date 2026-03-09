# Release Checklist v1.1.0

Project: Trade Union Group Manager (Tauri v2 desktop app)
Target release tag: `v1.1.0`

## 1. Scope Freeze

- [ ] Confirm release scope (features + bug fixes) and stop adding non-release changes.
- [ ] Create release branch (or confirm release is from `main`).
- [ ] Record commit hash used as release candidate (RC).

## 2. Git Hygiene (Blocker Gate)

- [ ] Run `git status --short` and resolve unexpected untracked files.
- [ ] Decide if these files must be committed or ignored:
  - `src-tauri/Cargo.lock`
  - `src-tauri/gen/`
  - `src-tauri/icons/`
  - `src-tauri/scripts/finalize_group.ps1`
  - `src-tauri/scripts/single_email_action.ps1`
- [ ] Update `.gitignore` if any generated files should stay out of source control.
- [ ] Ensure no local-only secrets or test data are included.

## 3. Version and Metadata

- [ ] Bump version to `1.1.0` in:
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
- [ ] Confirm app metadata is correct:
  - product name
  - bundle identifier
  - author/team fields
- [ ] Prepare release notes (changes, fixes, known limitations).

## 4. Build and Compile Gates

- [ ] `npm ci` (clean install)
- [ ] `npm run build`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] `npm run tauri build` (final packaging test)
- [ ] Validate build artifacts are created in Tauri output directory.

## 5. Runtime Prerequisites

- [ ] Confirm target machines have PowerShell 7+ (`ForEach-Object -Parallel` is required).
- [ ] Confirm ExchangeOnlineManagement module install path/permissions are acceptable.
- [ ] Confirm first-run auth flow (Exchange sign-in prompt) works on a clean machine.

## 6. Functional QA (Manual)

- [ ] Load queues from `emails.txt` and `removeemail.txt` at startup.
- [ ] Paste parser accepts newline/comma/space-separated emails.
- [ ] Invalid emails are rejected; valid emails are normalized to lowercase.
- [ ] Duplicate handling is correct across both queues.
- [ ] Drag/drop between Add/Remove lanes works.
- [ ] Delete button removes a single item and persists to files.
- [ ] Empty queue blocks action and shows clear error in Activity Log.
- [ ] Group email validation blocks invalid input.
- [ ] Group email persists across app restarts.
- [ ] `Run Add` processes add queue, clears queue on success, and refreshes state.
- [ ] `Run Remove` processes remove queue, clears queue on success, and refreshes state.
- [ ] `final.txt` is exported after action and contains current group members.
- [ ] Idle reconnect logic works after 5 minutes inactivity (`forceReconnect` path).
- [ ] Progress bar and success/fail badges match actual counts from backend.

## 7. Exchange Behavior QA (Safe Test Group)

- [ ] Add existing member (should fail gracefully, counted in failed).
- [ ] Remove non-member (should fail gracefully, counted in failed).
- [ ] Mixed list (valid + invalid + duplicates) returns correct success/failed counts.
- [ ] Larger batch (for example 50-200 emails) completes without hang.
- [ ] Verify output parsing from `RESULT_JSON:` is stable.

## 8. Documentation Consistency

- [ ] Align README flow with actual implemented UI/commands.
- [ ] Document current limitation: execution path is Exchange PowerShell (Graph path not implemented).
- [ ] Add/update troubleshooting section:
  - Exchange module install issues
  - authentication prompts
  - permission errors on group membership updates

## 9. Packaging and Signing

- [ ] Decide whether `bundle.active` should be `true` for release build.
- [ ] Verify required script/resources are bundled.
- [ ] If code signing is required, sign installer/executable.
- [ ] Smoke test installer on a clean Windows machine.

## 10. Go/No-Go Checklist

- [ ] No blocker/P0 defects open.
- [ ] Release notes approved.
- [ ] Build artifact approved by QA/owner.
- [ ] Tag is ready: `v1.1.0`.

## 11. Release Execution

- [ ] Merge release branch (if used).
- [ ] Create and push tag `v1.1.0`.
- [ ] Publish artifacts (installer + checksum + notes).
- [ ] Announce release with install/upgrade instructions.

## 12. Post-Release

- [ ] Smoke test production-installed build.
- [ ] Monitor first-run failures (auth/module/install errors).
- [ ] Keep rollback instructions and previous stable installer available.
