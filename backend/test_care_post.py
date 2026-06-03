import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app import app
from auth import create_access_token
from database import get_db

client = TestClient(app)

def test_submission():
    # Find a citizen user
    with get_db() as cursor:
        cursor.execute("SELECT id, username, email, role FROM users WHERE role = 'citizen' LIMIT 1;")
        user = cursor.fetchone()
        
    if not user:
        print("No citizen user found in DB")
        return

    print("Found user:", user)
    
    # Generate token
    token = create_access_token(str(user['id']), user['role'], user['email'])
    headers = {"Authorization": f"Bearer {token}"}
    
    payload = {
        "title": "Water supply needed at camp 4",
        "category": "Food & Water",
        "description": "This is a detailed description of the situation where water is urgently needed.",
        "location_text": "Near Community Center",
        "district": "Nellore",
        "ward": "Ward 12",
        "urgency_score": 3,
        "severity_level": 3
    }
    
    print("Sending payload:", payload)
    response = client.post("/api/care/reports", json=payload, headers=headers)
    print("Response status:", response.status_code)
    print("Response JSON:", response.text)

if __name__ == "__main__":
    test_submission()
