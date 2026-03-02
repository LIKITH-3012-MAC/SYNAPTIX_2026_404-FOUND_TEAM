from fastapi import Request
from fastapi.responses import JSONResponse
import logging

logger = logging.getLogger("resolvit.exceptions")

async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global Exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"message": "An unexpected internal server error occurred.", "detail": str(exc)},
    )

async def value_error_handler(request: Request, exc: ValueError):
    logger.warning(f"Value Error: {exc}")
    return JSONResponse(
        status_code=400,
        content={"message": "Invalid request parameter", "detail": str(exc)},
    )
