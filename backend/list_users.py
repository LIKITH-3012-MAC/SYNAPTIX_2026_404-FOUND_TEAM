import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/resolvit")

def list_users():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        query = """
        SELECT username, email, role, full_name, is_active, created_at 
        FROM users 
        ORDER BY created_at DESC;
        """
        
        cur.execute(query)
        users = cur.fetchall()
        
        if not users:
            print("\n[!] No users found in the database.")
            return

        print("\n" + "="*100)
        print(f"{'USERNAME':<15} | {'EMAIL':<30} | {'ROLE':<10} | {'FULL NAME':<20} | {'STATUS'}")
        print("-" * 100)
        
        for user in users:
            status = "Active" if user['is_active'] else "Inactive"
            full_name = user['full_name'] or "N/A"
            print(f"{user['username']:<15} | {user['email']:<30} | {user['role']:<10} | {full_name:<20} | {status}")
            
        print("="*100)
        print(f"Total Users: {len(users)}\n")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[ERROR] Could not fetch users: {e}")

if __name__ == "__main__":
    list_users()
