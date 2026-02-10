"""Tests for Trade Union Member Management System"""

import unittest
import os
import json
from trade_union import TradeUnion, TradeUnionMember


class TestTradeUnionMember(unittest.TestCase):
    """Test TradeUnionMember class"""
    
    def test_member_creation(self):
        """Test creating a member"""
        member = TradeUnionMember('001', 'John Doe', 'john@example.com', '2024-01-01')
        self.assertEqual(member.member_id, '001')
        self.assertEqual(member.name, 'John Doe')
        self.assertEqual(member.email, 'john@example.com')
        self.assertEqual(member.join_date, '2024-01-01')
    
    def test_member_to_dict(self):
        """Test member to dictionary conversion"""
        member = TradeUnionMember('001', 'John Doe', 'john@example.com', '2024-01-01')
        data = member.to_dict()
        self.assertEqual(data['member_id'], '001')
        self.assertEqual(data['name'], 'John Doe')
        self.assertEqual(data['email'], 'john@example.com')
        self.assertEqual(data['join_date'], '2024-01-01')
    
    def test_member_from_dict(self):
        """Test creating member from dictionary"""
        data = {
            'member_id': '001',
            'name': 'John Doe',
            'email': 'john@example.com',
            'join_date': '2024-01-01'
        }
        member = TradeUnionMember.from_dict(data)
        self.assertEqual(member.member_id, '001')
        self.assertEqual(member.name, 'John Doe')


class TestTradeUnion(unittest.TestCase):
    """Test TradeUnion class"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.test_file = 'test_members.json'
        if os.path.exists(self.test_file):
            os.remove(self.test_file)
        self.union = TradeUnion(self.test_file)
    
    def tearDown(self):
        """Clean up test fixtures"""
        if os.path.exists(self.test_file):
            os.remove(self.test_file)
    
    def test_add_member(self):
        """Test adding a member"""
        result = self.union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
        self.assertTrue(result)
        self.assertEqual(self.union.get_member_count(), 1)
    
    def test_add_duplicate_member(self):
        """Test adding duplicate member fails"""
        self.union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
        result = self.union.add_member('001', 'Jane Doe', 'jane@example.com', '2024-01-02')
        self.assertFalse(result)
        self.assertEqual(self.union.get_member_count(), 1)
    
    def test_remove_member(self):
        """Test removing a member"""
        self.union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
        self.assertEqual(self.union.get_member_count(), 1)
        
        result = self.union.remove_member('001')
        self.assertTrue(result)
        self.assertEqual(self.union.get_member_count(), 0)
    
    def test_remove_nonexistent_member(self):
        """Test removing nonexistent member fails"""
        result = self.union.remove_member('999')
        self.assertFalse(result)
    
    def test_remove_member_multiple_members(self):
        """Test removing specific member from multiple members"""
        self.union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
        self.union.add_member('002', 'Jane Smith', 'jane@example.com', '2024-01-02')
        self.union.add_member('003', 'Bob Wilson', 'bob@example.com', '2024-01-03')
        self.assertEqual(self.union.get_member_count(), 3)
        
        # Remove middle member
        result = self.union.remove_member('002')
        self.assertTrue(result)
        self.assertEqual(self.union.get_member_count(), 2)
        
        # Verify correct member was removed
        self.assertIsNotNone(self.union.get_member('001'))
        self.assertIsNone(self.union.get_member('002'))
        self.assertIsNotNone(self.union.get_member('003'))
    
    def test_get_member(self):
        """Test getting a member by ID"""
        self.union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
        member = self.union.get_member('001')
        self.assertIsNotNone(member)
        self.assertEqual(member.name, 'John Doe')
    
    def test_get_nonexistent_member(self):
        """Test getting nonexistent member returns None"""
        member = self.union.get_member('999')
        self.assertIsNone(member)
    
    def test_list_members(self):
        """Test listing all members"""
        self.union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
        self.union.add_member('002', 'Jane Smith', 'jane@example.com', '2024-01-02')
        
        members = self.union.list_members()
        self.assertEqual(len(members), 2)
    
    def test_persistence(self):
        """Test data persistence across instances"""
        self.union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
        
        # Create new instance
        union2 = TradeUnion(self.test_file)
        self.assertEqual(union2.get_member_count(), 1)
        member = union2.get_member('001')
        self.assertIsNotNone(member)
        self.assertEqual(member.name, 'John Doe')
    
    def test_persistence_after_removal(self):
        """Test data persistence after member removal"""
        self.union.add_member('001', 'John Doe', 'john@example.com', '2024-01-01')
        self.union.add_member('002', 'Jane Smith', 'jane@example.com', '2024-01-02')
        self.union.remove_member('001')
        
        # Create new instance
        union2 = TradeUnion(self.test_file)
        self.assertEqual(union2.get_member_count(), 1)
        self.assertIsNone(union2.get_member('001'))
        self.assertIsNotNone(union2.get_member('002'))


if __name__ == '__main__':
    unittest.main()
