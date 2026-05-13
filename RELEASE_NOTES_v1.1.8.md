# Trade Union Group Manager v1.1.8

Release date: 2026-04-22
Tag: `v1.1.8`

## Release Table

| Item | Value |
| --- | --- |
| Product | Trade Union Group Manager |
| Version | 1.1.8 |
| Tag | v1.1.8 |
| Platform | Windows (Tauri v2) |
| Runtime | Exchange Online PowerShell |

## Change Table

| Area | Update |
| --- | --- |
| Authentication | Reuses the Microsoft admin auth session for up to 10 minutes after a successful run |
| Credential Lifecycle | Admin credential cache now expires after 10 minutes or when the app closes |
| Credential Storage | Admin password cache moved from encrypted disk file to in-memory app state only |
| Compatibility | Legacy `.credentials/admin_credential.json` is cleared automatically if it exists |
| Session Stability | Removed per-run Exchange disconnect so short-lived Microsoft session reuse can work between actions |

## Build/Verify

- `npm run build`
- `cargo check`
- PowerShell parse check for `src-tauri/scripts/manage_distribution_group.ps1`

## Notes

- The app still uses Exchange Online PowerShell for group updates.
- Microsoft/WAM may provide silent sign-in behavior outside the app, but the app-controlled credential cache now follows the 10-minute session rule.
