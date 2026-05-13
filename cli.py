"""Command Line Interface for Trade Union Management"""

import sys
from trade_union import TradeUnion


def print_menu():
    """Print the main menu"""
    print("\n=== Trade Union Management System ===")
    print("1. Add member")
    print("2. Remove member")
    print("3. List all members")
    print("4. View member details")
    print("5. Exit")
    print("=" * 36)


def add_member_interactive(union: TradeUnion):
    """Interactive member addition"""
    print("\n--- Add New Member ---")
    member_id = input("Member ID: ").strip()
    name = input("Name: ").strip()
    email = input("Email: ").strip()
    join_date = input("Join Date (YYYY-MM-DD): ").strip()
    
    if union.add_member(member_id, name, email, join_date):
        print(f"✓ Member '{name}' added successfully!")
    else:
        print(f"✗ Member with ID '{member_id}' already exists!")


def remove_member_interactive(union: TradeUnion):
    """Interactive member removal"""
    print("\n--- Remove Member ---")
    member_id = input("Enter Member ID to remove: ").strip()
    
    member = union.get_member(member_id)
    if member:
        confirm = input(f"Remove member '{member.name}' (ID: {member_id})? (yes/no): ").strip().lower()
        if confirm in ['yes', 'y']:
            if union.remove_member(member_id):
                print(f"✓ Member '{member.name}' removed successfully!")
            else:
                print(f"✗ Failed to remove member!")
        else:
            print("Removal cancelled.")
    else:
        print(f"✗ Member with ID '{member_id}' not found!")


def list_members_interactive(union: TradeUnion):
    """Interactive member listing"""
    print("\n--- All Members ---")
    members = union.list_members()
    
    if not members:
        print("No members found.")
    else:
        print(f"Total members: {len(members)}")
        print()
        for member in members:
            print(member)


def view_member_interactive(union: TradeUnion):
    """Interactive member viewing"""
    print("\n--- View Member Details ---")
    member_id = input("Enter Member ID: ").strip()
    
    member = union.get_member(member_id)
    if member:
        print("\nMember Details:")
        print(f"  ID: {member.member_id}")
        print(f"  Name: {member.name}")
        print(f"  Email: {member.email}")
        print(f"  Join Date: {member.join_date}")
    else:
        print(f"✗ Member with ID '{member_id}' not found!")


def main():
    """Main CLI loop"""
    union = TradeUnion()
    
    while True:
        print_menu()
        choice = input("\nEnter your choice (1-5): ").strip()
        
        if choice == '1':
            add_member_interactive(union)
        elif choice == '2':
            remove_member_interactive(union)
        elif choice == '3':
            list_members_interactive(union)
        elif choice == '4':
            view_member_interactive(union)
        elif choice == '5':
            print("\nGoodbye!")
            sys.exit(0)
        else:
            print("\n✗ Invalid choice! Please enter 1-5.")


if __name__ == '__main__':
    main()
