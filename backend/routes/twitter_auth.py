from fastapi import APIRouter, HTTPException, Request, Depends, Query
from fastapi.responses import RedirectResponse
import os
import httpx
import secrets
import base64
import hashlib
from datetime import datetime, timezone

from database import get_db
from auth import create_access_token
from utils.crypto_utils import encrypt_token

router = APIRouter()

# ── Twitter OAuth 2.0 Config ─────────────────────────────────
CLIENT_ID     = os.getenv("TWITTER_CLIENT_ID")
CLIENT_SECRET = os.getenv("TWITTER_CLIENT_SECRET")
# This must match what is in Twitter Dev Portal
REDIRECT_URI  = os.getenv("TWITTER_REDIRECT_URI", "https://resolvit-app-2026.vercel.app/twitter-callback.html")

AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize"
TOKEN_URL     = "https://api.twitter.com/2/oauth2/token"
USER_ME_URL   = "https://api.twitter.com/2/users/me"

# ── Helpers ──────────────────────────────────────────────────

@router.get("/authorize")
async def twitter_authorize(request: Request):
    """
    Step 1: Returns the Twitter Authorization URL.
    The frontend should redirect the user here.
    """
    if not CLIENT_ID:
        raise HTTPException(status_code=500, detail="Twitter Client ID not configured.")
    
    # In a direct flow, the frontend usually handles state/challenge generation
    # but we can provide helper params or just let the frontend do it.
    # To keep this robust, we'll return the base authorize URL and params.
    
    state = secrets.token_urlsafe(32)
    # The frontend will generate its own PKCE challenge and verifier
    # and we will receive the code on callback.
    
    return {
        "url": AUTHORIZE_URL,
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "users.read tweet.read offline.access",
        "state": state
    }

@router.post("/callback")
async def twitter_callback(payload: dict):
    """
    Step 2: Receives the authorization code from the frontend.
    Exchanges it for tokens, fetches profile, and syncs user.
    """
    code          = payload.get("code")
    code_verifier = payload.get("code_verifier")
    
    if not code or not code_verifier:
        raise HTTPException(status_code=400, detail="Missing authorization code or verifier.")

    if not CLIENT_ID or not CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Twitter credentials not configured.")

    # 1. Exchange Code for Access Token
    auth_str = f"{CLIENT_ID}:{CLIENT_SECRET}"
    encoded_auth = base64.b64encode(auth_str.encode()).decode()
    
    token_data = {
        "code": code,
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": code_verifier
    }
    
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                TOKEN_URL,
                data=token_data,
                headers={"Authorization": f"Basic {encoded_auth}"}
            )
            if resp.status_code != 200:
                print(f"[TWITTER-AUTH-ERROR] Token Exchange Failed: {resp.text}")
                raise HTTPException(status_code=400, detail=f"Token exchange failed: {resp.text}")
            
            tokens = resp.json()
            access_token  = tokens.get("access_token")
            refresh_token = tokens.get("refresh_token") # Only if offline.access was requested
            
            # 2. Fetch User Profile
            # Request specific fields: id, name, username, profile_image_url
            profile_resp = await client.get(
                USER_ME_URL,
                params={"user.fields": "id,name,username,profile_image_url,verified"},
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if profile_resp.status_code != 200:
                print(f"[TWITTER-AUTH-ERROR] Profile Fetch Failed: {profile_resp.text}")
                raise HTTPException(status_code=400, detail="Failed to fetch Twitter profile.")
            
            x_data = profile_resp.json().get("data", {})
            x_id       = str(x_data.get("id"))
            x_username = x_data.get("username")
            x_name     = x_data.get("name", x_username)
            x_avatar   = x_data.get("profile_image_url")
            
            # 3. Synchronize with Database
            with get_db() as cursor:
                # Try to find existing user by provider + provider_user_id
                cursor.execute(
                    "SELECT id, role, username, email FROM users WHERE auth_provider = 'twitter' AND provider_user_id = %s",
                    (x_id,)
                )
                user = cursor.fetchone()
                
                if user:
                    # Update tokens for existing user
                    cursor.execute(
                        """
                        UPDATE users SET 
                            twitter_access_token_encrypted = %s,
                            twitter_refresh_token_encrypted = %s,
                            username = %s,
                            full_name = %s,
                            profile_picture = %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (encrypt_token(access_token), encrypt_token(refresh_token), x_username, x_name, x_avatar, user["id"])
                    )
                    user_id = user["id"]
                    role    = user["role"]
                    email   = user["email"]
                    username = user["username"]
                    print(f"[TWITTER-AUTH] Updated existing user: {x_username}")
                else:
                    # Create new user
                    # Ensure unique username logic (simplified here)
                    cursor.execute("SELECT id FROM users WHERE username = %s", (x_username,))
                    final_username = x_username
                    if cursor.fetchone():
                        final_username = f"{x_username}_{secrets.token_hex(2)}"
                    
                    cursor.execute(
                        """
                        INSERT INTO users (
                            full_name, username, role, auth_provider, provider_user_id, 
                            profile_picture, twitter_access_token_encrypted, twitter_refresh_token_encrypted
                        ) VALUES (%s, %s, 'citizen', 'twitter', %s, %s, %s, %s)
                        RETURNING id, role, username
                        """,
                        (x_name, final_username, x_id, x_avatar, encrypt_token(access_token), encrypt_token(refresh_token))
                    )
                    new_user = cursor.fetchone()
                    user_id = new_user["id"]
                    role    = new_user["role"]
                    username = new_user["username"]
                    email   = None # No email for Twitter/X by default
                    print(f"[TWITTER-AUTH] Created new user: {final_username}")

            # 4. Generate Local JWT
            local_token = create_access_token(
                user_id=str(user_id),
                role=role,
                email=email or f"{username}@twitter.resolvit-ai.online" # Placeholder for JWT if needed
            )
            
            return {
                "success": True,
                "access_token": local_token,
                "user": {
                    "id": str(user_id),
                    "username": username,
                    "role": role,
                    "avatar": x_avatar
                }
            }
            
        except httpx.HTTPError as e:
            print(f"[TWITTER-AUTH-FATAL] HTTP Error: {e}")
            raise HTTPException(status_code=500, detail="External API communication failure.")
        except Exception as e:
            print(f"[TWITTER-AUTH-FATAL] Unknown Error: {e}")
            raise HTTPException(status_code=500, detail=str(e))
