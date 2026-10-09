# Trade Union Group Manager v2.0.7

Release date: 2026-10-09
Tag: `v2.0.7`

## Bug Fixes & Improvements

- **Clear duplicate-member error reporting (Distribution Groups):**
  - When a Run action tries to add an email that already exists in a distribution group, the error is now classified into a friendly message: `Duplicate: email is already a member of this group.` instead of the raw Exchange Online exception text.
  - Added `Get-FriendlyActionError` in `manage_distribution_group.ps1`, recognizing all Exchange variants (`already exists`, `IdentityAlreadyMember`, `MemberAlreadyExists`, ...). Unrecognized errors keep their original specific message.
  - Result table now shows a visible **Message** column (previously the error text was only a hover tooltip), red for failures, muted grey for successes.
  - Duplicate failures are surfaced in the log box, log history (View Logs), and screen-reader alert region as before; other queued emails continue to be processed.

- **Ambiguous-recipient handling (per-email unique ID):**
  - Emails whose address is stamped on multiple Microsoft 365 objects (e.g. a mailbox and a mail contact — reported with `quan.tran@premex.com`) made both Add and Remove fail with the raw "There are multiple recipients matching the identity" error.
  - The script now pins every email to a single directory object ID (GUID) before acting: membership is first checked against the target group's actual member list (exact GUID match), then against the directory via `Get-Recipient -Filter "EmailAddresses -eq ..."` with deterministic precedence (UserMailbox > MailUser > SharedMailbox > MailContact > ...).
  - Ambiguous resolutions are announced in the log with the chosen object type and GUID; friendlier errors were added for "not a member" and "not found in directory" cases; other queued emails continue to be processed.

## Verification

- `node --test tests/*.test.mjs` → 183/183 pass
- `cargo test --manifest-path src-tauri/Cargo.toml` → 15/15 pass
- `cargo check --manifest-path src-tauri/Cargo.toml` → clean
- `npm run build` → frontend bundle built successfully

## Notes

- Upgrade from v2.0.6 is supported via the stable WiX `upgradeCode` (`142d4337-ebfa-5a2e-a5f7-33592dce26d6`); the NSIS clean-install hook removes the previous build before copying the new one without affecting user app data.
- Installer asset SHA256 hashes to be appended after `npm run tauri -- build`.
