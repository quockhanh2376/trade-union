# Trade Union Group Manager v1.1.11

Release date: 2026-05-20

## Fixes

- Restores the Microsoft sign-in prompt when PowerShell is launched hidden for add/remove member actions.
- Keeps the PowerShell console hidden by using the existing hidden process launch path.
- Uses `-DisableWAM` when supported by ExchangeOnlineManagement so browser-based Microsoft auth can appear even without a visible console window.
- Applies the same guarded Exchange connection behavior to group detection and legacy Exchange scripts.

## Verification

- `cargo test --manifest-path src-tauri\Cargo.toml`
- PowerShell parser validation for Exchange scripts
- `npm run build`
- `npm run tauri -- build`
