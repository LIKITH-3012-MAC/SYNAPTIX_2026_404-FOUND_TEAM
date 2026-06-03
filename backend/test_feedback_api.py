import requests

def test_api():
    # 1. Login
    login_url = "http://localhost:8000/api/auth/login"
    login_payload = {
        "email": "sarithasmily18@gmail.com",
        "password": "Password123"
    }
    
    try:
        # First try to register if user doesn't exist
        reg_url = "http://localhost:8000/api/auth/register"
        reg_payload = {
            "username": "saritha",
            "email": "sarithasmily18@gmail.com",
            "password": "Password123",
            "role": "citizen"
        }
        requests.post(reg_url, json=reg_payload)
        
        login_res = requests.post(login_url, json=login_payload)
        print("Login Status:", login_res.status_code)
        if login_res.status_code != 200:
            print("Login failed, trying direct user...")
            # try fallback user in database
            # let's try authority user
            login_payload = {
                "email": "auth_water@resolvit.gov.in",
                "password": "Password123"
            }
            login_res = requests.post(login_url, json=login_payload)
            print("Fallback Login Status:", login_res.status_code)
            
        token = login_res.json().get("access_token")
        if not token:
            print("No access token found!")
            return
            
        print("Obtained Access Token successfully.")
        
        # 2. Submit Feedback
        feedback_url = "http://localhost:8000/api/feedback"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        feedback_payload = {
            "ui_rating": 5,
            "ux_rating": 4,
            "experience_rating": 5,
            "comment": "Excellent experience with the new multi-step wizard UI!"
        }
        
        res = requests.post(feedback_url, json=feedback_payload, headers=headers)
        print("Feedback API Status Code:", res.status_code)
        print("Feedback API Response:", res.json())
        
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    test_api()
