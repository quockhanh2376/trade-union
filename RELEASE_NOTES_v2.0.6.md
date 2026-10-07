# Trade Union Group Manager v2.0.6

Release date: 2026-10-07
Tag: `v2.0.6`

## New Features & Improvements

- **Change Password Tab:**
  - Added dedicated "Change Password" tab allowing administrators to update passwords for Microsoft 365 user accounts directly.
  - Integrated with Microsoft Graph PowerShell (`Microsoft.Graph.Users`), supporting modern authentication and multi-factor authentication (MFA).
  - Optimized execution window: PowerShell console runs minimized directly to the Taskbar via Win32 `ShowWindowAsync` hook, displaying only the native Microsoft 365 sign-in dialog in the foreground.
  - Persistent target email configuration with a quick `✓ Save` button (defaults to `aswhiteplus@aswhiteglobal.com`).
  - Password visibility toggle (`Show / Hide password`).
  - Checkbox option to require the user to change password at next sign-in (`ForceChangePasswordNextSignIn`).
  - Animated loading state with spinner and pulsing glow on the submit button during processing.
  - Clean error formatting that strips PowerShell ANSI escape sequences from Microsoft Graph error messages.

- **Distribution Groups Tab:**
  - Preserved all existing drag-and-drop queue management (Add / Remove) with live counter badges, deduplication, sorting, and multi-group sequential processing.
  - Offline bundled `ExchangeOnlineManagement` modules and modern auth with disabled WAM for Exchange cmdlets.

## Verification

- `node --test tests/*.test.mjs` → 183/183 pass
- `cargo test --manifest-path src-tauri/Cargo.toml` → 15/15 pass
- `cargo check --manifest-path src-tauri/Cargo.toml` → clean
- `npm run build` → frontend bundle built successfully
- `npm run tauri -- build` → produced MSI + NSIS installers

## Assets

| File | SHA256 |
|------|--------|
| `Trade Union Group Manager_2.0.6_x64_en-US.msi` | `d1b5727e8842bddffc3dd9122653d08de0892f32d5f516dd2a987b8c39eaa1f3` |
| `Trade Union Group Manager_2.0.6_x64-setup.exe` | `2fedfa9cb8ca75dfc6dbfd1ed47ab1c887262c13bfa52b89765df8308e45de88` |

## Notes

- Upgrade from v2.0.5 is supported via the stable WiX `upgradeCode` (`142d4337-ebfa-5a2e-a5f7-33592dce26d6`); the NSIS clean-install hook removes the previous build before copying the new one without affecting user app data.
