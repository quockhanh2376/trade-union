# Trade Union Mini App (Tauri v2)

Desktop mini app for managing a distribution group with 2 queues:
- `Add Queue`: emails to add into the group
- `Remove Queue`: emails to remove from the group

## Stack
- Tauri v2
- TypeScript + Vite
- Rust backend commands
- PowerShell script for Exchange Online

## Run Locally
1. Install Node.js LTS, Rust toolchain, and Visual Studio Build Tools (Desktop C++).
2. Install dependencies:
   ```powershell
   npm install
   ```
3. Start the app:
   ```powershell
   npm run tauri dev
   ```

## Flow
1. Enter group email, then click `Check Group Type`.
2. App shows one of `Distribution / M365 / Security`.
3. Graph path is auto-locked when result is `Distribution`.
4. App loads queues from `emails.txt` and `removeemail.txt`.
5. User drags emails between Add and Remove columns.
6. `Run Remove` calls Rust backend, then runs `src-tauri/scripts/manage_distribution_group.ps1` with action `Remove`.
7. Script updates the group and exports current members to `final.txt`.

## Optional Environment Variables
- `TRADE_UNION_GROUP`: override default distribution group email.
- `TRADE_UNION_ROOT`: override workspace root path for queue files.

## Notes
- First run may install `ExchangeOnlineManagement` automatically.
- Each action may require Exchange Online sign-in.
- Graph mode is currently gated by group type check only; Add/Remove execution still uses Exchange PowerShell in this build.
