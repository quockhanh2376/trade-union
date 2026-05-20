"""Trade Union Member Management System"""

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
_DATE_FORMAT = '%Y-%m-%d'


class TradeUnionDataError(Exception):
    """Raised when persisted trade union data cannot be loaded safely"""


class TradeUnionValueError(ValueError):
    """Raised when input data fails validation"""


@dataclass(frozen=True)
class TradeUnionMember:
    """Represents a trade union member"""

    member_id: str
    name: str
    email: str
    join_date: str
    
    def to_dict(self) -> Dict:
        """Convert member to dictionary"""
        return {
            'member_id': self.member_id,
            'name': self.name,
            'email': self.email,
            'join_date': self.join_date
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'TradeUnionMember':
        """Create member from dictionary"""
        return cls(
            member_id=data['member_id'],
            name=data['name'],
            email=data['email'],
            join_date=data['join_date']
        )
    
    def __str__(self) -> str:
        return f"Member(ID: {self.member_id}, Name: {self.name}, Email: {self.email}, Joined: {self.join_date})"


class TradeUnion:
    """Trade Union management system"""
    
    def __init__(self, data_file: str = 'members.json'):
        self.data_file = data_file
        self.members: Dict[str, TradeUnionMember] = {}
        self.load_members()
    
    def load_members(self):
        """Load members from file"""
        if not os.path.exists(self.data_file):
            self.members = {}
            return

        try:
            with open(self.data_file, 'r') as f:
                data = json.load(f)
            if not isinstance(data, list):
                raise TradeUnionDataError('Member data must be a list')
            loaded_members = {m['member_id']: TradeUnionMember.from_dict(m) for m in data}
        except json.JSONDecodeError as exc:
            raise TradeUnionDataError(f'Unable to decode member data from {self.data_file}') from exc
        except (KeyError, TypeError) as exc:
            raise TradeUnionDataError(f'Member data in {self.data_file} has an unexpected shape') from exc

        self.members = loaded_members
    
    def save_members(self):
        """Save members to file"""
        temp_file = f"{self.data_file}.tmp"
        try:
            with open(temp_file, 'w') as f:
                json.dump([m.to_dict() for m in self.members.values()], f, indent=2)
            os.replace(temp_file, self.data_file)
        finally:
            if os.path.exists(temp_file):
                os.remove(temp_file)
    
    def add_member(self, member_id: str, name: str, email: str, join_date: str) -> bool:
        """Add a new member"""
        if not _EMAIL_RE.match(email):
            raise TradeUnionValueError(f'Invalid email address: {email}')
        try:
            datetime.strptime(join_date, _DATE_FORMAT)
        except ValueError:
            raise TradeUnionValueError(f'Invalid join_date, expected YYYY-MM-DD: {join_date}')

        if member_id in self.members:
            return False

        member = TradeUnionMember(member_id, name, email, join_date)
        self.members[member_id] = member
        self.save_members()
        return True
    
    def remove_member(self, member_id: str) -> bool:
        """Remove a member by ID"""
        if member_id not in self.members:
            return False
        del self.members[member_id]
        self.save_members()
        return True
    
    def get_member(self, member_id: str) -> Optional[TradeUnionMember]:
        """Get a member by ID"""
        return self.members.get(member_id)
    
    def list_members(self) -> List[TradeUnionMember]:
        """List all members"""
        return list(self.members.values())
    
    def get_member_count(self) -> int:
        """Get total number of members"""
        return len(self.members)
