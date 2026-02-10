"""Trade Union Member Management System"""

import json
import os
from typing import List, Dict, Optional


class TradeUnionMember:
    """Represents a trade union member"""
    
    def __init__(self, member_id: str, name: str, email: str, join_date: str):
        self.member_id = member_id
        self.name = name
        self.email = email
        self.join_date = join_date
    
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
        self.members: List[TradeUnionMember] = []
        self.load_members()
    
    def load_members(self):
        """Load members from file"""
        if os.path.exists(self.data_file):
            try:
                with open(self.data_file, 'r') as f:
                    data = json.load(f)
                    self.members = [TradeUnionMember.from_dict(m) for m in data]
            except (json.JSONDecodeError, KeyError):
                self.members = []
        else:
            self.members = []
    
    def save_members(self):
        """Save members to file"""
        with open(self.data_file, 'w') as f:
            json.dump([m.to_dict() for m in self.members], f, indent=2)
    
    def add_member(self, member_id: str, name: str, email: str, join_date: str) -> bool:
        """Add a new member"""
        if self.get_member(member_id):
            return False
        
        member = TradeUnionMember(member_id, name, email, join_date)
        self.members.append(member)
        self.save_members()
        return True
    
    def remove_member(self, member_id: str) -> bool:
        """Remove a member by ID"""
        member_to_remove = None
        for member in self.members:
            if member.member_id == member_id:
                member_to_remove = member
                break
        
        if member_to_remove:
            self.members.remove(member_to_remove)
            self.save_members()
            return True
        return False
    
    def get_member(self, member_id: str) -> Optional[TradeUnionMember]:
        """Get a member by ID"""
        for member in self.members:
            if member.member_id == member_id:
                return member
        return None
    
    def list_members(self) -> List[TradeUnionMember]:
        """List all members"""
        return self.members
    
    def get_member_count(self) -> int:
        """Get total number of members"""
        return len(self.members)
