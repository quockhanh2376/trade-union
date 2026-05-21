# Trade Union Group Manager v2.0.1

Release date: 2026-05-21

## Improvements

- Email List now auto-sorts alphabetically, removes duplicate entries, and strips blank lines after clicking **Add** or **Remove**.

## Verification

- `node --test tests\installer-clean-upgrade.test.mjs tests\clear-bulk-input-ui.test.mjs`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run build`
- `npm run tauri -- build`
