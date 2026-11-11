"""Sparse vector encoder for Pinecone hybrid search.

Generates sparse vectors (BM25-style term-frequency representation) from text
for use alongside dense embeddings in Pinecone's hybrid search.

Sparse vectors capture exact keyword matches while dense vectors capture
semantic meaning — the combination is more precise than either alone.

Implementation: Simple hash-based token frequency encoder. Each token is
hashed to a stable integer index, and the value is the normalized term
frequency. This avoids needing a pre-built vocabulary or external model.

Note: For production at scale, consider upgrading to Pinecone's inference
API sparse encoder or a SPLADE model for better quality.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from typing import Dict, List, Optional, Tuple

from app.core.logging import get_logger

logger = get_logger("services.sparse_encoder")

# Maximum sparse vector dimension for Pinecone (hash space)
_MAX_DIM = 2**31 - 1  # Pinecone supports up to 2^31-1 sparse dimensions


def _tokenize(text: str) -> List[str]:
    """Tokenize text into lowercase alphanumeric tokens.

    Splits on non-alphanumeric characters and filters out very short tokens
    and common English stop words that add noise to sparse matching.
    """
    tokens = re.findall(r"[a-z0-9]+", text.lower())

    # Filter stop words and very short tokens (len < 2) for cleaner sparse vectors
    return [t for t in tokens if len(t) >= 2 and t not in _STOP_WORDS]


def _hash_token(token: str) -> int:
    """Hash a token to a stable integer index within Pinecone's sparse dimension range.

    Uses MD5 for speed + determinism (not security-sensitive).
    """
    h = hashlib.md5(token.encode("utf-8")).hexdigest()
    return int(h[:8], 16) % _MAX_DIM


def encode_sparse(text: str) -> Dict[str, List]:
    """Generate a Pinecone-compatible sparse vector from text.

    Args:
        text: Input text (profile description, tags, search query, etc.)

    Returns:
        Dict with 'indices' (List[int]) and 'values' (List[float]).
        Ready to pass directly to Pinecone's upsert/query as sparse_values.
        Returns empty sparse vector if text is empty.

    Example:
        >>> sv = encode_sparse("jazz musician london live performance")
        >>> sv["indices"]  # [382947, 1029384, ...]
        >>> sv["values"]   # [0.447, 0.447, ...]
    """
    if not text or not text.strip():
        return {"indices": [], "values": []}

    tokens = _tokenize(text)
    if not tokens:
        return {"indices": [], "values": []}

    # Count term frequencies
    tf = Counter(tokens)
    total = len(tokens)

    # Build sparse vector: hash each unique token → normalized TF value
    # Using sub-linear TF: 1 + log(count) to dampen high-frequency terms
    indices = []
    values = []
    seen_indices = set()

    for token, count in tf.items():
        idx = _hash_token(token)

        # Handle hash collisions — skip if same index already used
        if idx in seen_indices:
            continue
        seen_indices.add(idx)

        # Sub-linear TF normalization: log(1 + tf) / log(1 + total)
        value = (1.0 + math.log(count)) / (1.0 + math.log(total))
        indices.append(idx)
        values.append(round(value, 6))

    logger.debug(
        "Sparse vector encoded",
        token_count=len(tokens),
        unique_indices=len(indices),
    )

    return {"indices": indices, "values": values}


def hybrid_score_norm(
    dense: List[float],
    sparse: Dict[str, List],
    alpha: float = 0.75,
) -> tuple:
    """Apply convex combination weighting to a hybrid dense+sparse query vector.

    Pinecone does not have a built-in alpha parameter — this is the recommended
    approach from Pinecone's official documentation to adjust the balance.

    Formula:  alpha * dense + (1 - alpha) * sparse

    Args:
        dense: Dense embedding vector (list of floats)
        sparse: Sparse vector dict with 'indices' and 'values'
        alpha: Weight for dense component (0.0 = pure sparse, 1.0 = pure dense).
               Default 0.75 = mostly semantic with some keyword boosting.

    Returns:
        Tuple of (scaled_dense, scaled_sparse) ready for index.query()
    """
    if not 0.0 <= alpha <= 1.0:
        raise ValueError(f"alpha must be between 0 and 1, got {alpha}")

    scaled_sparse = {
        "indices": sparse["indices"],
        "values": [v * (1.0 - alpha) for v in sparse["values"]],
    }
    scaled_dense = [v * alpha for v in dense]
    return scaled_dense, scaled_sparse


def build_sparse_text_for_profile(
    profile_text: str,
    tags: Optional[List[str]] = None,
    passion: Optional[str] = None,
    image_tags: Optional[List[str]] = None,
    backstory_tags: Optional[List[str]] = None,
    video_summary: Optional[str] = None,
) -> str:
    """Combine profile sources into a single text optimized for sparse encoding.

    Tags and passion are repeated to boost their weight in BM25-style matching,
    since they're the highest-signal fields for keyword matches.

    Args:
        profile_text: Base profile text (bio, username, etc.)
        tags: User skill tags
        passion: Primary talent role
        image_tags: Tags from image analysis
        backstory_tags: Tags from CV/backstory PDF
        video_summary: Summary from video analysis

    Returns:
        Combined text string for sparse encoding.
    """
    parts = []

    # Passion repeated 3x for high weight
    if passion:
        parts.extend([passion] * 3)

    # Tags repeated 2x
    if tags:
        tag_text = " ".join(tags)
        parts.extend([tag_text] * 2)

    # Profile text 1x
    if profile_text:
        parts.append(profile_text)

    # Image tags 1x
    if image_tags:
        parts.append(" ".join(image_tags))

    # Backstory tags 1x
    if backstory_tags:
        parts.append(" ".join(backstory_tags))

    # Video summary 1x (truncated)
    if video_summary:
        parts.append(video_summary[:300])

    return " ".join(parts)


# ---------------------------------------------------------------------------
# Common English stop words (minimal set to avoid over-filtering)
# ---------------------------------------------------------------------------
_STOP_WORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "as", "be", "was", "were",
    "are", "am", "been", "being", "has", "had", "have", "do", "does",
    "did", "will", "would", "could", "should", "may", "might", "can",
    "this", "that", "these", "those", "he", "she", "we", "they", "me",
    "my", "your", "his", "her", "its", "our", "their", "not", "no",
    "so", "if", "than", "too", "very", "just", "about", "up", "out",
    "all", "also", "each", "which", "when", "what", "who", "how",
    "i", "you",
})
