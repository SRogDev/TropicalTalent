"""Phase 3 adaptive discovery — pure requirement logic (no LLM, no I/O).

The graph's `understand` node runs the LLM intent extractor when it
works and merges it with this local extraction; when Gemini is down,
local extraction alone still drives the clarify-vs-search decision.
Nothing here invents requirements: a field is set only when the user's
own words state it.

Decision rule (plan §4, adaptive behaviour):
  - search immediately when the request is sufficiently clear
    (a category, a named skill/passion, a location, or >= 3 content terms)
  - ask at most 2 targeted questions, at most 2 rounds, otherwise
  - search with whatever requirements exist (partial results included)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MAX_CLARIFICATION_QUESTIONS = 2
MAX_CLARIFICATION_ROUNDS = 2

# Category keywords, English + Spanish. A match only sets the category;
# it never invents a skill, a place, or availability.
_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "talent": (
        "developer", "designer", "photographer", "musician", "engineer",
        "writer", "editor", "illustrator", "videographer", "talent",
        "freelancer", "desarrollador", "diseñador", "fotógrafo",
        "fotografo", "músico", "musico", "ingeniero", "escritor",
        "programador", "talento",
    ),
    "services": (
        "service", "services", "marketing", "consulting", "translation",
        "accounting", "legal", "servicio", "servicios", "consultoría",
        "consultoria", "traducción", "traduccion", "contabilidad",
    ),
    "products": (
        "product", "products", "goods", "supply", "coffee", "honey",
        "rum", "cigar", "producto", "productos", "café", "cafe", "miel",
        "ron", "tabaco", "artesanía", "artesania", "azúcar", "azucar",
        "mango", "cacao",
    ),
}

_STOPWORDS = frozenset(
    """
    i need want find looking for me a an the and or to in of with
    busco necesito quiero encontrar para mi un una el la los las de
    en con por que es son se su sus y o
    """.split()
)

_GREETING_RE = re.compile(
    r"^\s*(hi|hello|hey|hola|buenas|buenos días|buenos dias|good morning|"
    r"good afternoon|thanks|thank you|gracias|help|ayuda)\b",
    re.IGNORECASE,
)
_COMPARE_RE = re.compile(
    r"\b(compare|versus|\bvs\b|better than|which (one|is better)|"
    r"comparar|cuál es mejor|cual es mejor)\b",
    re.IGNORECASE,
)
_PERSON_RE = re.compile(
    r"(tell me more about|more about|who is|what does|profile of|"
    r"deep dive|cuéntame más|cuentame mas|quién es|quien es|@\w+)",
    re.IGNORECASE,
)
_SPANISH_HINT_RE = re.compile(
    r"\b(busco|necesito|quiero|hola|gracias|para mi|para mí)\b",
    re.IGNORECASE,
)


@dataclass
class Requirements:
    """Structured requirements extracted from one user message."""

    category: str | None = None
    terms: list = field(default_factory=list)
    location: str | None = None
    passion: str | None = None
    raw_query: str = ""

    def to_dict(self) -> dict:
        return {
            "category": self.category,
            "terms": list(self.terms),
            "location": self.location,
            "passion": self.passion,
            "raw_query": self.raw_query,
        }

    @classmethod
    def from_dict(cls, data: dict | None) -> "Requirements":
        data = data or {}
        return cls(
            category=data.get("category"),
            terms=list(data.get("terms") or []),
            location=data.get("location"),
            passion=data.get("passion"),
            raw_query=data.get("raw_query") or "",
        )


def extract_requirements_local(query: str) -> Requirements:
    """Deterministic extraction from the user's own words."""
    text = (query or "").strip()
    lowered = text.lower()
    category = None
    for name, keywords in _CATEGORY_KEYWORDS.items():
        if any(kw in lowered for kw in keywords):
            category = name
            break
    tokens = re.findall(r"[a-záéíóúñü]+", lowered)
    terms = [t for t in tokens if len(t) >= 3 and t not in _STOPWORDS]
    # Keep order, drop duplicates.
    terms = list(dict.fromkeys(terms))
    return Requirements(category=category, terms=terms, raw_query=text)


def is_sufficient(req: Requirements) -> bool:
    """True when the request is clear enough to search immediately."""
    if req.category or req.passion or req.location:
        return True
    return len(req.terms) >= 3


def _is_spanish(query: str) -> bool:
    return bool(_SPANISH_HINT_RE.search(query or ""))


def clarification_questions(req: Requirements) -> list:
    """At most 2 targeted questions about what is actually missing."""
    spanish = _is_spanish(req.raw_query)
    questions: list = []
    if not req.category:
        questions.append(
            "¿Buscas talento, un servicio o un producto?"
            if spanish
            else "Are you looking for talent, a service, or a product?"
        )
    if not req.terms and not req.passion:
        questions.append(
            "¿Qué habilidades, producto o detalles son más importantes?"
            if spanish
            else "What skills, product, or details matter most?"
        )
    elif not req.location:
        questions.append(
            "¿Hay alguna ciudad o lugar que prefieras?"
            if spanish
            else "Is there a city or place you prefer?"
        )
    return questions[:MAX_CLARIFICATION_QUESTIONS]


def is_legacy_turn(query: str) -> bool:
    """True for turns the existing AgentExecutor already handles well:
    greetings, comparing two people, and asking about a named person.
    Those go to the legacy_agent node, preserving current behaviour."""
    text = (query or "").strip()
    return bool(
        _GREETING_RE.search(text)
        or _COMPARE_RE.search(text)
        or _PERSON_RE.search(text)
    )


def summarize_offers_text(offers: list, query: str) -> str:
    """Deterministic summary listing only the offers actually found.

    No availability, verification, or quality claim is ever added here —
    the card itself shows the provider-stated fields.
    """
    if not offers:
        return (
            "I couldn't find a matching offer for that request. "
            "I can save it as a sourcing request so Cubora looks for a "
            "supplier and lets you know when a real opportunity appears."
        )
    lines = [f"I found {len(offers)} matching offer(s):"]
    for offer in offers:
        provider = offer.get("provider") or {}
        name = provider.get("displayName") or provider.get("display_name") or ""
        where = offer.get("city") or ""
        bits = [offer.get("title") or "Untitled offer"]
        if name:
            bits.append(f"by {name}")
        if where:
            bits.append(f"in {where}")
        lines.append(" - " + ", ".join(bits))
    lines.append("Ask me to refine the search or tell you more about any of these.")
    return " ".join(lines)
