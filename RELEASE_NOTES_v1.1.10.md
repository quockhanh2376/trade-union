# Trade Union Group Manager v1.1.10

Release date: 2026-05-20
Tag: `v1.1.10`

## Release Table

| Item | Value |
| --- | --- |
| Product | Trade Union Group Manager |
| Version | 1.1.10 |
| Tag | v1.1.10 |
| Platform | Windows (Tauri v2) |
| Runtime | Exchange Online PowerShell |

## Change Table

| Area | Update |
| --- | --- |
| Exchange Execution | Runs Exchange Online PowerShell without showing the PowerShell console window |
| Output Handling | Pipes PowerShell stdout/stderr back to the app for existing result and error display |
| Authentication | Keeps the Microsoft admin sign-in flow visible when Exchange Online requires login or 2FA |
| WebView2 Runtime | Switches Windows packaging to WebView2 `offlineInstaller` so the installer works without downloading WebView2 at install time |
| Release Packaging | Bumps app/package/Cargo versions to 1.1.10 |

## Build/Verify

- `npm ci`
- `npm run build`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run tauri -- build`

## Notes

- The app still uses Exchange Online PowerShell for group updates.
- The Microsoft sign-in window/browser can still appear; only the PowerShell console window is hidden.
- Offline WebView2 packaging increases the installer size to about 202-204 MB.
- `npm ci` reports existing dependency audit findings: 3 moderate and 1 high.
