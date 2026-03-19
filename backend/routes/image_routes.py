"""
RESOLVIT - Image BLOB Storage Routes
Stores images in PostgreSQL as BYTEA for persistent storage on Render.

POST /api/images/upload     - Upload image → store as BLOB in DB → return URL
GET  /api/images/{image_id} - Serve image from DB BLOB
"""
import uuid
from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from fastapi.responses import Response
from database import get_db

router = APIRouter()

# Max image size: 5MB
MAX_IMAGE_SIZE = 5 * 1024 * 1024


@router.post("/upload")
async def upload_image_blob(request: Request, file: UploadFile = File(...)):
    """
    Upload an image file and store it as a BLOB in PostgreSQL.
    Returns a permanent URL that serves the image from the database.
    """
    # Validate file type
    allowed_types = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"}
    content_type = file.content_type or "image/jpeg"
    if content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"File type '{content_type}' not allowed. Use JPEG, PNG, GIF, or WebP.")

    # Read file data
    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Image too large. Maximum 5MB allowed.")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    # Generate ID and extract extension
    image_id = str(uuid.uuid4())
    original_name = file.filename or "upload.jpg"

    # Store in PostgreSQL
    with get_db() as cursor:
        cursor.execute(
            """
            INSERT INTO image_store (id, data, mime_type, original_name, size_bytes)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (image_id, data, content_type, original_name, len(data))
        )

    # Build the permanent URL
    base_url = str(request.base_url).rstrip("/")
    # Force HTTPS on production
    if "render.com" in base_url or "vercel" in base_url:
        base_url = base_url.replace("http://", "https://")

    image_url = f"{base_url}/api/images/{image_id}"

    return {
        "url": image_url,
        "image_id": image_id,
        "size": len(data),
        "mime_type": content_type,
        "original_name": original_name
    }


@router.get("/{image_id}")
def serve_image(image_id: str):
    """
    Serve an image from the PostgreSQL BLOB store.
    Returns raw image bytes with proper Content-Type and caching headers.
    """
    with get_db() as cursor:
        cursor.execute(
            "SELECT data, mime_type, original_name FROM image_store WHERE id = %s",
            (image_id,)
        )
        row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Image not found")

    return Response(
        content=bytes(row["data"]),
        media_type=row["mime_type"],
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Disposition": f'inline; filename="{row["original_name"]}"',
            "X-Content-Type-Options": "nosniff",
        }
    )
