import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from fastapi.testclient import TestClient
from app import app
from auth import create_access_token
from database import get_db

def test_endpoint():
    client = TestClient(app)
    
    # 1. Fetch a user id from database
    with get_db() as cursor:
        cursor.execute("SELECT id, email, role, department FROM users LIMIT 1;")
        user = cursor.fetchone()
        
    if not user:
        print("No users found in database.")
        return
        
    print("Simulating endpoint call for user:", user)
    
    # 2. Create access token
    access_token = create_access_token(
        user_id=str(user["id"]),
        role=user["role"],
        email=user["email"],
        department=user["department"]
    )
    
    # 3. Post to feedback endpoint
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    payload = {
        "ui_rating": 5,
        "ux_rating": 5,
        "experience_rating": 4,
        "comment": "Testing the FastAPI endpoint directly via TestClient."
    }
    
    response = client.post("/api/feedback", json=payload, headers=headers)
    print("Response Status Code:", response.status_code)
    print("Response JSON:", response.json())
    
    # 4. Check DB
    with get_db() as cursor:
        cursor.execute("SELECT * FROM app_feedback WHERE comment = %s ORDER BY created_at DESC LIMIT 1;", (payload["comment"],))
        row = cursor.fetchone()
        print("Verified row stored in database:", row)

if __name__ == "__main__":
    test_endpoint()
