"""Webhook routes — receives QStash messages for durable background processing.

Currently handles:
  POST /api/webhooks/vectorize — profile vectorization job (published by Next.js)

Authentication: QStash HMAC-SHA256 signature (no user JWT required).
QStash docs: https://upstash.com/docs/qstash/howto/signature
"""

import json
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.core import get_logger
from app.core.config import get_settings
from app.models.vectorize import ProfileData, VectorizeProfileRequest
from app.services.vectorize import vectorize_profile

router = APIRouter(prefix="/api/webhooks", tags=["Webhooks"])
logger = get_logger("tropicaltalent.router.webhooks")
settings = get_settings()


# ─── Signature verification ───────────────────────────────────────────────────


async def _verify_qstash_signature(request: Request, upstash_signature: Optional[str]) -> None:
    """Verify the request genuinely came from QStash.

    QStash signs every delivery with HMAC-SHA256 using the current or next signing key.
    Raises HTTP 401 on failure.
    """
    if not upstash_signature:
        logger.warning("QStash webhook called without signature")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Upstash-Signature header")

    if not settings.qstash_current_signing_key:
        # Signing keys not configured — skip in dev/test but block in prod
        logger.warning("QSTASH_CURRENT_SIGNING_KEY not configured; skipping signature check (dev mode)")
        return

    try:
        from qstash import Receiver  # noqa: PLC0415

        receiver = Receiver(
            current_signing_key=settings.qstash_current_signing_key,
            next_signing_key=settings.qstash_next_signing_key or settings.qstash_current_signing_key,
        )
        body_bytes = await request.body()
        is_valid = receiver.verify(
            signature=upstash_signature,
            body=body_bytes.decode("utf-8"),
        )
        if not is_valid:
            raise ValueError("Signature mismatch")

    except ImportError:
        # qstash SDK not installed — allow in dev without keys
        logger.warning("qstash Python SDK not installed; signature check skipped")
        return

    except (ValueError, Exception) as exc:
        logger.warning(f"QStash signature verification failed: {exc}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid QStash signature")


# ─── Vectorize webhook ────────────────────────────────────────────────────────


@router.post("/vectorize", status_code=status.HTTP_200_OK)
async def webhook_vectorize(
    request: Request,
    upstash_signature: Optional[str] = Header(None, alias="upstash-signature"),
) -> dict:
    """Receive a profile vectorization job from QStash.

    QStash publishes here after Next.js calls publishVectorize().
    Processes synchronously so QStash can see the result and retry on failure.
    Timeout is configured to 120 s on the publisher side.

    Flow:
        Next.js publishVectorize()
        → QStash
        → POST /api/webhooks/vectorize
        → vectorize_profile()
        → Pinecone upsert
    """
    await _verify_qstash_signature(request, upstash_signature)

    # ── Parse body ──────────────────────────────────────────────────────────
    body_bytes = await request.body()
    try:
        payload = json.loads(body_bytes)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON: {exc}")

    user_id: Optional[str] = payload.get("userId")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing userId in payload")

    raw_profile: dict = payload.get("profile", {})
    youtube_url: Optional[str] = raw_profile.get("video") or None

    try:
        # Note: location_id is omitted — Next.js sends a pre-resolved location string.
        # We capture it in the `location` field and vectorize_profile uses it as a fallback.
        profile = ProfileData(
            username=raw_profile.get("username", ""),
            bio=raw_profile.get("bio"),
            tags=raw_profile.get("tags", []),
            passion=raw_profile.get("passion"),
            avatar=raw_profile.get("avatar"),
            location=raw_profile.get("location") or None,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid profile payload: {exc}")

    vec_request = VectorizeProfileRequest(
        user_id=user_id,
        profile=profile,
        youtube_url=youtube_url,
    )

    logger.info("QStash vectorize webhook: starting", user_id=user_id)

    # ── Run vectorization (sync — QStash waits up to 120 s) ────────────────
    try:
        result = await vectorize_profile(vec_request)
    except Exception as exc:  # noqa: BLE001
        logger.error("QStash vectorization exception", user_id=user_id, error=str(exc))
        # Return 500 → QStash will retry (up to configured retries)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Vectorization failed: {exc}",
        )

    if result.success:
        logger.info("QStash vectorization complete", user_id=user_id, vector_id=result.vector_id)
        return {"status": "ok", "userId": user_id, "vectorId": result.vector_id}

    # Permanent failure — no embeddable content, retrying won't help
    if "No content to vectorize" in (result.message or ""):
        logger.warning("QStash vectorization skipped (permanent — no content)", user_id=user_id, message=result.message)
        return {"status": "skipped", "userId": user_id, "reason": result.message}

    # Transient/infrastructure failure (e.g. Pinecone index missing or misconfigured).
    # Return 500 so QStash retries the job.
    logger.error("QStash vectorization failed (will retry)", user_id=user_id, message=result.message)
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Vectorization failed: {result.message}",
    )
