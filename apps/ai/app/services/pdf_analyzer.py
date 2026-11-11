"""PDF analyzer service: extract text with PyMuPDF and extract tags using Gemini.

This module provides a small async-friendly wrapper that:
- reads PDF bytes efficiently using asyncio.to_thread + PyMuPDF
- asks the Gemini chat model to return a JSON array of tags
- normalizes and lemmatizes tags using the existing text_processor
- returns a list[str] (empty list on any error)
"""
from __future__ import annotations

import asyncio
import json
import re
import textwrap
from typing import List, Optional

import fitz  # PyMuPDF
from fastapi import UploadFile

from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.text_processor import lemmatize_texts_batch, normalize_text

logger = get_logger("services.pdf_analyzer")


def _get_pdf_model() -> ChatGoogleGenerativeAI:
    """Get Gemini model configured for PDF tag extraction (1000 max tokens)."""
    model = getattr(_get_pdf_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.3,
            max_output_tokens=1000,
        )
        setattr(_get_pdf_model, "_model", model)
        logger.info("Gemini 2.5 flash PDF model initialized")
    return model


async def _extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Run PyMuPDF extraction in a thread to avoid blocking the event loop."""

    def _sync_extract(data: bytes) -> str:
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            pages_text = []
            for page in doc:
                # use get_text() default which is fast; keep simple
                pages_text.append(page.get_text())
            return "\n".join(pages_text)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("PyMuPDF extraction failed", error=str(exc))
            return ""

    return await asyncio.to_thread(_sync_extract, pdf_bytes)


async def analyze_pdf(pdf_file: UploadFile) -> List[str]:
    """Extract talent tags from a PDF UploadFile.

    Args:
        pdf_file: FastAPI `UploadFile` instance for a PDF backstory

    Returns:
        List[str]: Normalized + lemmatized tags. Returns [] on any failure.
    """
    try:
        if pdf_file is None:
            return []

        # Read bytes from UploadFile (async)
        pdf_bytes = await pdf_file.read()
        if not pdf_bytes:
            return []

        # 1) Extract text from PDF efficiently
        text = await _extract_text_from_pdf_bytes(pdf_bytes)
        if not text or not text.strip():
            return []

        # 2) Build a concise prompt asking Gemini for a JSON array of tags
        prompt = textwrap.dedent(
            """
            You are an expert assistant that extracts concise, useful tags from a
            professional's backstory text. Read the provided backstory
            content and return a JSON array of 15-20 short tags (strings).

            Tags should include ONLY the following categories when present:
            - Artistic skills and techniques (e.g., "digital painting", "3D modeling")
            - Creative tools and software (e.g., "Photoshop", "Blender")
            - Artistic styles and genres (e.g., "minimalist", "surrealism")
            - Creative industries (e.g., "game design", "advertising")
            - Media types (e.g., "illustration", "animation")
            - Professional roles (e.g., "graphic designer", "motion designer")

            Return ONLY a valid JSON array, for example: ["tag1", "tag2", ...]
            Do NOT include any surrounding explanation or extra text.

            Backstory text:
            """
        )

        # Append a short excerpt to keep prompt size sensible for multi-page PDFs
        excerpt = text[:12000]
        prompt = prompt + "\n" + excerpt

        # 3) Call Gemini model with dedicated 1000-token limit (async)
        model = _get_pdf_model()
        response = await model.ainvoke(prompt)
        content = getattr(response, "content", "") or ""

        # 4) Try to parse JSON array from the model output
        raw_tags: Optional[List[str]] = None
        try:
            raw_tags = json.loads(content)
            if not isinstance(raw_tags, list):
                raw_tags = None
        except Exception:
            # Attempt to extract first JSON array substring if model wrapped extra text
            m = re.search(r"\[.*\]", content, flags=re.S)
            if m:
                try:
                    raw_tags = json.loads(m.group(0))
                except Exception:
                    raw_tags = None

        if not raw_tags:
            logger.warning(
                "Gemini did not return a valid JSON array for PDF tags",
            )
            return []

        # 5) Normalize and lemmatize tags using batch text_processor pipeline
        # First normalize all tags
        normalized_tags: List[str] = []
        for tag in raw_tags:
            if not isinstance(tag, str):
                continue
            n = normalize_text(tag)
            if n:
                normalized_tags.append(n)

        if not normalized_tags:
            return []

        # Batch lemmatize all tags in a single API call (was previously per-tag)
        lemmatized_tags = await lemmatize_texts_batch(normalized_tags)

        # Collapse whitespace in each result
        cleaned: List[str] = []
        for tag in lemmatized_tags:
            t = " ".join(tag.split())
            if t:
                cleaned.append(t)

        # 6) Deduplicate while preserving order and limit to 20 tags
        seen = set()
        deduped: List[str] = []
        for t in cleaned:
            if t in seen:
                continue
            seen.add(t)
            deduped.append(t)
            if len(deduped) >= 20:
                break

        return deduped

    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Creative PDF tag extraction failed", error=str(exc))
        return []
