# Trade Union Group Manager v2.0.8

Release date: 2026-10-09
Tag: `v2.0.8`

## New Features & Improvements

- **Manual member export via Export button:**
  - Run actions (Add/Remove) no longer write the member export — no more "Updated members exported to ..." lines on every run.
  - A new **Export** button next to the Email List counter exports the current member list of every configured group to `final.txt`. Export is read-only: membership is never modified. Multi-group exports are combined (first group overwrites, later groups append).
  - Log output for exports is compact: `Exported N members for <group>` plus a single completion line.

- **Cleaner, color-coded logs:**
  - PowerShell run output is compacted: per-email lines become `✓ email` / `✗ email` with indented failure reasons (`↳ ...`); the raw RESULT_JSON blob, duplicate aggregate counters and absolute export paths are dropped.
  - Log lines are color-coded for fast scanning — errors red, warnings yellow, successful emails green, run summaries bold white, queue actions blue, timestamps muted — in both the live log box and the View Logs history.
  - Log font enlarged ~10% (0.82 → 0.9rem) with wrapped lines (no more horizontal cut-off) and 24-hour timestamps.

## Verification

- `node --test tests/*.test.mjs` → 187/187 pass
- `cargo test --manifest-path src-tauri/Cargo.toml` → 15/15 pass
- `cargo check --manifest-path src-tauri/Cargo.toml` → clean
- `npm run build` → frontend bundle built successfully
- `npm run tauri -- build` → produced MSI + NSIS installers

## Assets

| File | Size | SHA256 |
|------|------|--------|
| `Trade Union Group Manager_2.0.8_x64_en-US.msi` | TBD | TBD |
| `Trade Union Group Manager_2.0.8_x64-setup.exe` | TBD | TBD |

## Notes

- Installers use the WebView2 `downloadBootstrapper` (no embedded offline installer — ≈150 MB smaller).
- Upgrade from earlier versions is supported via the stable WiX `upgradeCode` (`142d4337-ebfa-5a2e-a5f7-33592dce26d6`); the NSIS clean-install hook removes the previous build before copying the new one without affecting user app data.
