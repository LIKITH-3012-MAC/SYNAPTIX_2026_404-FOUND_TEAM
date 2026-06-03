import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import get_db
import uuid

def test():
    with get_db() as cursor:
        # Check if table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'app_feedback'
            );
        """)
        table_exists = cursor.fetchone()['exists']
        print("Does app_feedback table exist?", table_exists)
        
        if not table_exists:
            print("ERROR: app_feedback table does not exist in DB!")
            return

        cursor.execute("SELECT id, username FROM users LIMIT 1;")
        user = cursor.fetchone()
        print("Using User:", user)
        
        if user:
            user_id = user['id']
            # Attempt insertion
            feedback_id = str(uuid.uuid4())
            try:
                cursor.execute(
                    """
                    INSERT INTO app_feedback (id, user_id, ui_rating, ux_rating, experience_rating, comment)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id;
                    """,
                    (feedback_id, user_id, 5, 4, 5, "Excellent interface redesign!")
                )
                res = cursor.fetchone()
                print("Success! Created feedback row:", res)
                
                # Fetch it back
                cursor.execute("SELECT * FROM app_feedback WHERE id = %s;", (feedback_id,))
                row = cursor.fetchone()
                print("Retrieved feedback row:", row)
            except Exception as e:
                import traceback
                traceback.print_exc()

if __name__ == "__main__":
    test()
