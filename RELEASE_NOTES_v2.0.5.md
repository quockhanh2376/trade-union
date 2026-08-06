# Trade Union Group Manager v2.0.5

Release date: 2026-08-06
Tag: `v2.0.5`

## Improvements

- **Email List count badge:** A circular counter next to the "Email List" label now shows the total number of valid emails currently in the input area. It updates live on paste/input, Add/Remove, Clear, and when the draft is restored from session storage. The badge dims when the list is empty.
- **Comma-separated multi-group support:** The Group field now accepts comma-separated emails (e.g. `group1@company.com, group2@company.com`) processed sequentially in user-entered order. When more than one group is queued, the activity log prints `Group order: g1 -> g2 -> g3` before running.
- **Build fix:** Re-aligned `src-tauri/Cargo.lock` to the application version (it had drifted to `2.0.3` in `v2.0.4`).

## Verification

- `node --test tests\clear-bulk-input-ui.test.mjs tests\exchange-module-bundle.test.mjs tests\installer-clean-upgrade.test.mjs` → 14/14 pass
- `cargo test --manifest-path src-tauri\Cargo.toml` → 4/4 pass (modern auth, DisableWAM, verbatim path, module separator)
- `cargo check --manifest-path src-tauri\Cargo.toml` → clean
- `npm run build` → frontend built
- `npm run tauri -- build` → produced MSI + NSIS installers

## Assets

| File | SHA256 |
|------|--------|
| `Trade Union Group Manager_2.0.5_x64_en-US.msi` | `9b1bc21c87e6bd38e0f5f3ec3f8e6cb6f56e4056fee2214d93da7e733637fd4e` |
| `Trade Union Group Manager_2.0.5_x64-setup.exe` | `ff72b65ab8329e23af8367460e54a68f5a0cd73ad95db0f16f40c7e6637df454` |

## Notes

- Upgrade from v2.0.4 is supported via the stable WiX `upgradeCode` (`142d4337-...`); the NSIS clean-install hook removes the previous build before copying the new one.
- Execution path is still Exchange PowerShell (modern auth, MFA-capable). Graph path remains out of scope for this release.
