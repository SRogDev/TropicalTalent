"""Admin routes — internal endpoints for maintenance and backfill operations.

Authentication: X-Admin-Key header must match settings.internal_api_key.
These endpoints are NOT exposed to end users.
"""

import asyncio
from typing import List, Optional

import sentry_sdk
from fastapi import APIRouter, Header, HTTPException, Query, status
from supabase import create_client

from app.core import get_logger
from app.core.config import get_settings
from app.models.vectorize import ProfileData, VectorizeProfileRequest
from app.services.vectorize import vectorize_profile

router = APIRouter(prefix="/api/admin", tags=["Admin"])
logger = get_logger("tropicaltalent.router.admin")
settings = get_settings()


def _verify_admin_key(x_admin_key: Optional[str]) -> None:
    """Raise 403 if the admin key header is missing or incorrect."""
    if not x_admin_key or x_admin_key != settings.internal_api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing X-Admin-Key header",
        )


async def _fetch_all_users() -> List[dict]:
    """Fetch all rows from `users` and `users_data`, merged by user id.

    `users` holds: id, username, avatar, bio, location, name
    `creative_data` holds: user_id, tags, passion
    """
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    page_size = 100

    # Fetch all users (profile data)
    all_users: List[dict] = []
    offset = 0
    while True:
        result = await asyncio.to_thread(
            client.table("users")
            .select("id, username, avatar, bio, name")
            .range(offset, offset + page_size - 1)
            .execute
        )
        batch = result.data or []
        all_users.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    # Fetch all creative_data (tags + passion)
    all_users_data: List[dict] = []
    offset = 0
    while True:
        result = await asyncio.to_thread(
            client.table(settings.users_data_table)
            .select("user_id, tags, passion")
            .range(offset, offset + page_size - 1)
            .execute
        )
        batch = result.data or []
        all_users_data.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    # Build lookup: user_id → users_data row
    users_data_by_id = {row["user_id"]: row for row in all_users_data}

    # Merge: attach users_data fields onto each user row
    for user in all_users:
        uid = user.get("id")
        extra = users_data_by_id.get(str(uid), {})
        user["video_tags"] = extra.get("tags") or []
        user["passion"] = extra.get("passion")

    return all_users


def _build_request(user: dict) -> Optional[VectorizeProfileRequest]:
    """Map merged users + users_data row to a VectorizeProfileRequest.

    Returns None if the row has no content worth vectorizing.
    """
    user_id = user.get("id")
    if not user_id:
        return None

    username = user.get("username") or user.get("name") or ""
    bio = user.get("bio")
    tags = user.get("video_tags") or []
    if not isinstance(tags, list):
        tags = []
    passion = user.get("passion")
    avatar = user.get("avatar")

    # Skip users with no vectorizable content
    has_content = any([bio, tags, passion, username])
    if not has_content:
        return None

    profile = ProfileData(
        username=username,
        bio=bio,
        tags=tags,
        passion=passion,
        avatar=avatar,
    )

    return VectorizeProfileRequest(
        user_id=str(user_id),
        profile=profile,
        youtube_url=None,
    )


@router.post("/backfill-vectors", status_code=status.HTTP_200_OK)
async def backfill_vectors(
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
    dry_run: bool = Query(False, description="Count users without vectorizing"),
) -> dict:
    """Vectorize all existing user profiles that are stored in Supabase.

    Reads every row from the `users` table, constructs a minimal profile
    (bio, tags, passion, username, location), and calls vectorize_profile()
    for each one.  Runs up to 3 vectorizations concurrently to avoid
    overwhelming OpenAI / Pinecone rate limits.

    Use ?dry_run=true to count users without running any vectorization.

    Authentication: X-Admin-Key header required.
    """
    _verify_admin_key(x_admin_key)

    logger.info("Backfill vectors requested", dry_run=dry_run)

    # ── Fetch all users ──────────────────────────────────────────────────────
    try:
        users = await _fetch_all_users()
    except Exception as exc:
        logger.error("Failed to fetch users for backfill", error=str(exc))
        with sentry_sdk.push_scope() as scope:
            scope.set_extra("endpoint", "backfill_vectors")
            sentry_sdk.capture_exception(exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch users: {exc}",
        )

    total = len(users)
    logger.info("Fetched users for backfill", total=total)

    if dry_run:
        return {"dry_run": True, "total": total}

    # ── Build requests, skip users with no content ───────────────────────────
    requests = []
    for user in users:
        req = _build_request(user)
        if req:
            requests.append(req)

    skipped = total - len(requests)

    # ── Vectorize with bounded concurrency ───────────────────────────────────
    semaphore = asyncio.Semaphore(3)
    succeeded = 0
    failed = 0
    errors: List[dict] = []

    async def _vectorize_one(req: VectorizeProfileRequest) -> None:
        nonlocal succeeded, failed
        async with semaphore:
            try:
                result = await vectorize_profile(req)
                if result.success:
                    logger.info("Backfill: vectorized user", user_id=req.user_id)
                    succeeded += 1
                else:
                    logger.warning(
                        "Backfill: vectorization returned non-success",
                        user_id=req.user_id,
                        message=result.message,
                    )
                    failed += 1
                    errors.append({"user_id": req.user_id, "error": result.message})
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "Backfill: vectorization exception",
                    user_id=req.user_id,
                    error=str(exc),
                )
                failed += 1
                errors.append({"user_id": req.user_id, "error": str(exc)})

    await asyncio.gather(*[_vectorize_one(req) for req in requests])

    logger.info(
        "Backfill complete",
        total=total,
        succeeded=succeeded,
        failed=failed,
        skipped=skipped,
    )

    return {
        "total": total,
        "succeeded": succeeded,
        "failed": failed,
        "skipped": skipped,
        "errors": errors,
    }
