from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request
from fastapi.responses import JSONResponse

# Increase headroom for general requests to prevent background noise triggers
# Sensitive routes (login) will have their own stricter overrides
limiter = Limiter(key_func=get_remote_address, default_limits=["400/minute"])

async def rate_limit_exceeded_handler(request: Request, exc):
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "message": "System workload high. Please wait a moment before trying again.",
            "retry_after": "60s"
        }
    )
