from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import logging

logger = logging.getLogger("resolvit.exceptions")

async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global Exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": "An unexpected internal server error occurred.",
            "detail": str(exc)
        },
    )

async def value_error_handler(request: Request, exc: ValueError):
    logger.warning(f"Value Error: {exc}")
    return JSONResponse(
        status_code=400,
        content={
            "success": False,
            "message": str(exc)
        },
    )

async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "message": exc.detail
        },
    )
