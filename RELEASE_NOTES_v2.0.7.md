# Trade Union Group Manager v2.0.7

Release date: 2026-10-09
Tag: `v2.0.7`

## Bug Fixes & Improvements

- **Clear duplicate-member error reporting (Distribution Groups):**
  - When a Run action tries to add an email that already exists in a distribution group, the error is now classified into a friendly message: `Duplicate: email is already a member of this group.` instead of the raw Exchange Online exception text.
  - Added `Get-FriendlyActionError` in `manage_distribution_group.ps1`, recognizing all Exchange variants (`already exists`, `IdentityAlreadyMember`, `MemberAlreadyExists`, ...). Unrecognized errors keep their original specific message.
  - Result table now shows a visible **Message** column (previously the error text was only a hover tooltip), red for failures, muted grey for successes.
  - Duplicate failures are surfaced in the log box, log history (View Logs), and screen-reader alert region as before; other queued emails continue to be processed.

- **Ambiguous-recipient handling:**
  - Emails whose address is stamped on multiple Microsoft 365 objects (e.g. a mailbox and a mail contact — reported with `quan.tran@premex.com`) made both Add and Remove fail with the raw "There are multiple recipients matching the identity" error.
  - The script now resolves each email to a unique directory object GUID via `Get-Recipient -Filter "EmailAddresses -eq ..."` before calling the member cmdlets; when the primary SMTP address matches exactly one object, that object is targeted.
  - If the address is still ambiguous, the email fails fast with a clear message telling the admin to remove/rename the duplicate object in the Microsoft 365 admin center; other queued emails continue to be processed.

## Verification

- `node --test tests/*.test.mjs` → 183/183 pass
- `cargo test --manifest-path src-tauri/Cargo.toml` → 15/15 pass
- `cargo check --manifest-path src-tauri/Cargo.toml` → clean
- `npm run build` → frontend bundle built successfully

## Notes

- Upgrade from v2.0.6 is supported via the stable WiX `upgradeCode` (`142d4337-ebfa-5a2e-a5f7-33592dce26d6`); the NSIS clean-install hook removes the previous build before copying the new one without affecting user app data.
- Installer asset SHA256 hashes to be appended after `npm run tauri -- build`.
