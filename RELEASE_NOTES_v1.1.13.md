# Trade Union Group Manager v1.1.13

Release date: 2026-05-20

## Fixes

- Windows installers now remove an existing Trade Union Group Manager installation before installing the new version.
- Pins the MSI WiX upgrade code so MSI upgrades continue to identify the app consistently across releases.
- Keeps user app data intact while cleaning the installed app binaries, shortcuts, and installer registry entries.

## Verification

- `node --test tests\installer-clean-upgrade.test.mjs tests\clear-bulk-input-ui.test.mjs`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run build`
- `npm run tauri -- build`
