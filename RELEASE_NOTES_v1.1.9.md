# Trade Union Group Manager v1.1.9

Release date: 2026-05-13
Tag: `v1.1.9`

## Release Table

| Item | Value |
| --- | --- |
| Product | Trade Union Group Manager |
| Version | 1.1.9 |
| Tag | v1.1.9 |
| Platform | Windows (Tauri v2) |
| Runtime | Exchange Online PowerShell |

## Change Table

| Area | Update |
| --- | --- |
| Authentication | Keeps the modern Microsoft admin sign-in flow and short-lived auth reuse from v1.1.8 |
| Queue UI | Adds the email-list clear control and simplifies Add/Remove queue buttons |
| Run Controls | Uses compact play-style Run buttons for both Add and Remove lanes |
| Release Packaging | Stores queue/result files in the app data directory instead of relying on ignored local text files |
| Bundled Resources | Bundles only the required PowerShell scripts and avoids packaging sensitive email-list files |
| Python Module | Adds safer trade union member persistence and review-feedback fixes from PR #1 |

## Build/Verify

- `python -m unittest`
- `npm run build`
- `cargo check`
- `npm run tauri build`

## Notes

- The app still uses Exchange Online PowerShell for group updates.
- Queue files are now runtime data, not release assets.
- `npm install` reports existing dependency audit findings: 3 moderate and 1 high.
