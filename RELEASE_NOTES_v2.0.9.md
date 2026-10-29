# Trade Union Group Manager v2.0.9

Release date: 2026-10-29
Tag: `v2.0.9`

## Security & Reliability Improvements (Round 2 Review)

- **Security Hardening:**
  - **Secure Password Handling:** New passwords are now passed securely to PowerShell via standard input pipe (`stdin`) instead of command-line arguments, preventing plaintext exposure in process listings, WMI queries (`Win32_Process`), event audit logs (Event 4688), or transcription logs.
  - **UTF-8 Non-ASCII Password Support:** Fixed console encoding mismatch so non-ASCII characters (e.g. accented characters, symbols) in passwords are preserved accurately.
  - **Line Break Prevention:** Passwords containing carriage return (`\r`) or newline (`\n`) characters are rejected upfront to prevent truncation.

- **Change Password Workflow:**
  - **Eliminated Device-Code Hang:** Removed the hidden device-code fallback that previously caused the application to hang until the 15-minute timeout. Microsoft Graph sign-in failures now report descriptive error messages immediately.
  - **Pinned Dependency Version:** Pinned `Microsoft.Graph.Users` to version `2.41.2` across runtime installation and import for predictable, consistent environments.
  - **First-Run Installation Guidance:** The UI spinner now explicitly informs users when Microsoft Graph module installation is occurring on first run, which may take a few minutes.
  - **Admin UPN Validation:** Invalid admin account emails now display an immediate validation error instead of silently falling back to null.
  - **Accurate Character Count:** Password length validation now counts Unicode scalar values without trimming whitespace, matching backend and frontend checks.

- **Distribution Group Management:**
  - **Unified Email Validation:** Standardized email validation regex across TypeScript frontend, Rust backend, and PowerShell scripts (`manage_distribution_group.ps1`).
  - **Zero Data Loss on Failure:** Queue reconciliation logic now safely preserves queued emails if a run fails or returns incomplete results, preventing accidental queue wipes.
  - **Invalid Email Accounting:** Formatted emails that fail syntax checks are tracked as failed detail items so counters and status indicators remain accurate.
  - **Unlimited Query Results:** Added `-ResultSize Unlimited` to all `Get-DistributionGroupMember` queries during member export and GUID pinning in Add/Remove actions, avoiding truncation for groups with over 1,000 members.

- **Performance & Frontend Polish:**
  - **Debounced Log Storage:** Debounced `localStorage` log history updates (500ms) with flush on `beforeunload` to eliminate disk serialization bottlenecks during high-volume operations.
  - **Capped Activity Log:** Capped DOM log box to the latest 1,000 lines to maintain fluid UI responsiveness over long sessions while preserving color coding and indentation.
  - **Consolidated Unload Lifecycle:** Merged auth session clearance and log history flushing into a single `beforeunload` handler.

- **Cleanup:**
  - Removed obsolete `detect_group_type.ps1` script and bundle resource.
  - Removed legacy prototype folder `New Feature/`.

## Verification

- `node --test tests/*.test.mjs` → 193/193 pass
- `cargo test --manifest-path src-tauri/Cargo.toml` → 26/26 pass
- `cargo check --manifest-path src-tauri/Cargo.toml` → clean
- `npm run build` → frontend bundle built successfully
- `npm run tauri -- build` → produced MSI + NSIS installers

## Assets

| File | Size | SHA256 |
|------|------|--------|
| `Trade Union Group Manager_2.0.9_x64_en-US.msi` | 16.0 MB | `55a08d8c3c74fdfcaee13f4405349fd3ff78b9887a049e7834c08aae5c06c8e2` |
| `Trade Union Group Manager_2.0.9_x64-setup.exe` | 10.8 MB | `31e062eb76273e6df40afa76583f9fdb8d2d60fb2c9e9c8bf8597f81ff0a0b5f` |

## Notes

- Installers use the WebView2 `downloadBootstrapper` (no embedded offline installer — ≈150 MB smaller).
- Upgrade from earlier versions is supported via the stable WiX `upgradeCode` (`142d4337-ebfa-5a2e-a5f7-33592dce26d6`); the NSIS clean-install hook removes the previous build before copying the new one without affecting user app data.
