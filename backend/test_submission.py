import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from services.workflow_engine import WorkflowEngine
from models import IssueCreate, IssueCategory
from database import get_db

def test():
    with get_db() as cursor:
        cursor.execute("SELECT id, username FROM users WHERE email = 'sarithasmily18@gmail.com' LIMIT 1;")
        user = cursor.fetchone()
        if not user:
            cursor.execute("SELECT id, username FROM users LIMIT 1;")
            user = cursor.fetchone()
            
        print("Using User:", user)
        
        if user:
            payload = IssueCreate(
                title="Pothole on Main Street 123",
                description="There is a large pothole that has been causing accidents on Main Street.",
                category=IssueCategory.Roads,
                latitude=12.9716,
                longitude=77.5946,
                urgency=3,
                impact_scale=10,
                safety_risk_probability=0.1,
                source="web"
            )
            try:
                res = WorkflowEngine.process_new_issue(payload, str(user['id']))
                print("Success! Created issue:", res)
            except Exception as e:
                import traceback
                traceback.print_exc()

if __name__ == "__main__":
    test()
