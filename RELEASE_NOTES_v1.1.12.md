# Trade Union Group Manager v1.1.12

Release date: 2026-05-20

## Fixes

- Disables each lane's `Run` button when its email queue is empty.
- Keeps `Run Add` enabled when Add has emails while `Run Remove` stays disabled if Remove is empty.
- Preserves the existing busy state so both run buttons are disabled while an action is processing.

## Verification

- `node --test tests\clear-bulk-input-ui.test.mjs`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- Browser verification on local Vite app
- `npm run build`
- `npm run tauri -- build`
