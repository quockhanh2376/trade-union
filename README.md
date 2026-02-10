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
