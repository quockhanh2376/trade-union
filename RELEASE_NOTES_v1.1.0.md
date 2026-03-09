# Trade Union Group Manager v1.1.0

Release date: 2026-03-09

## Highlights

- Refined board UI for queue operations (Add/Remove workflow).
- Queue controls and run actions are clearer for daily operations.
- Activity log and progress feedback are improved for execution visibility.

## Technical Updates

- Release version bumped to `1.1.0` in app metadata:
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
- Tauri bundle build is enabled for release packaging (`bundle.active = true`).
- Added release checklist for operational release flow:
  - `RELEASE_CHECKLIST_v1.1.0.md`

## Known Limitations

- Add/Remove execution path uses Exchange Online PowerShell scripts.
- Graph execution path is not implemented in this build.

## Upgrade Notes

- No data migration required.
- Queue files remain external (`emails.txt`, `removeemail.txt`, `final.txt`).

## Verification

- Frontend build: `npm run build`
- Backend compile check: `cargo check --manifest-path src-tauri/Cargo.toml`
