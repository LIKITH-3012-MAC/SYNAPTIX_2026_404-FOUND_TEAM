import requests

def test_upload():
    url = "http://localhost:8000/api/issues/upload"
    # Or test directly with the running gunicorn server on port 8000
    try:
        # Create a dummy image content
        files = {'file': ('test.jpg', b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00', 'image/jpeg')}
        
        # We need a token if it requires auth, but wait, does `/api/issues/upload` require auth?
        # Let's check backend/routes/issues.py:
        # @router.post("/upload", response_model=dict)
        # async def upload_image(request: Request, file: UploadFile = File(...)):
        # It does NOT have Depends(get_current_user)! It is public!
        
        r = requests.post(url, files=files)
        print("Status Code:", r.status_code)
        print("Response:", r.json())
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    test_upload()
