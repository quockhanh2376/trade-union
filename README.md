# Trade Union Management System

A simple Python-based system for managing trade union members with functionality to add, remove, and list members.

## Features

- ✅ Add new trade union members
- ✅ Remove trade union members by ID
- ✅ List all members
- ✅ View individual member details
- ✅ Persistent data storage (JSON)
- ✅ Command-line interface

## Installation

No external dependencies required. Uses Python 3.6+.

## Usage

### Command Line Interface

Run the interactive CLI:

```bash
python cli.py
```

The CLI provides the following options:
1. Add member
2. Remove member
3. List all members
4. View member details
5. Exit

### Programmatic Usage

```python
from trade_union import TradeUnion

# Create a trade union instance
union = TradeUnion()

# Add members
union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
union.add_member('002', 'Jane Smith', 'jane@example.com', '2024-01-02')

# Remove a member
union.remove_member('001')

# List all members
members = union.list_members()
for member in members:
    print(member)

# Get specific member
member = union.get_member('002')
print(f"Found: {member.name}")
```

## Testing

Run the test suite:

```bash
python -m unittest test_trade_union.py
```

Or run with verbose output:

```bash
python -m unittest test_trade_union.py -v
```

## Data Storage

Member data is stored in `members.json` in the current directory. The file is automatically created when you add the first member.
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
