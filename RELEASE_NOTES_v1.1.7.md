# Trade Union Group Manager v1.1.7

Release date: 2026-03-09
Tag: `v1.1.7`

## Release Table

| Item | Value |
| --- | --- |
| Product | Trade Union Group Manager |
| Version | 1.1.7 |
| Tag | v1.1.7 |
| Platform | Windows (Tauri v2) |
| Runtime | Exchange Online PowerShell |

## Change Table

| Area | Update |
| --- | --- |
| Distribution Groups | Support processing multiple groups in one run |
| Authentication | Added admin credential fields (UPN/password) with 2FA-friendly flow |
| Credential Security | Saved password is encrypted per Windows user (DPAPI) |
| Credential Lifecycle | Auto forget saved password after 10 minutes idle or when app closes |
| Execution Stability | Backend run moved to blocking task worker to reduce UI freeze |
| Result Visibility | Added per-email, per-group result table (`Ok`/`Fail`) |
| Queue Workflow | Auto-remove emails that succeeded across all selected groups |
| Auditability | Detailed fail logs include both group and email context |

## Build/Verify

- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`

## Notes

- Processing is sequential by group, then by email.
- If one email fails in one group, app logs the exact group/email error and continues remaining items.
