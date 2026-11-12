"""RED tests — Phase 3 adaptive discovery requirements (pure logic).

No LLM, no network: local keyword extraction, the clarify-vs-search
decision, clarification questions, legacy-turn routing, and the
deterministic offer-summary text (which must never invent supply).
"""

from app.services.discovery_requirements import (
    clarification_questions,
    extract_requirements_local,
    is_legacy_turn,
    is_sufficient,
    summarize_offers_text,
)


def test_extract_category_talent_english():
    req = extract_requirements_local("I need a React developer in Havana")
    assert req.category == "talent"
    assert "developer" in req.terms or "react" in req.terms


def test_extract_category_products_spanish():
    req = extract_requirements_local("Busco café cubano para exportar")
    assert req.category == "products"


def test_extract_category_services():
    req = extract_requirements_local("We need digital marketing services")
    assert req.category == "services"


def test_extract_no_category_for_vague_query():
    req = extract_requirements_local("hello there")
    assert req.category is None


def test_is_sufficient_with_category():
    req = extract_requirements_local("I need a designer")
    assert is_sufficient(req) is True


def test_is_sufficient_with_enough_terms_even_without_category():
    req = extract_requirements_local("quantum banana logistics orchestra")
    assert is_sufficient(req) is True


def test_is_not_sufficient_for_greeting():
    req = extract_requirements_local("hi")
    assert is_sufficient(req) is False


def test_clarification_questions_max_two_and_category_first():
    req = extract_requirements_local("I need something")
    questions = clarification_questions(req)
    assert 1 <= len(questions) <= 2
    assert "talent" in questions[0].lower()


def test_clarification_questions_spanish_when_query_spanish():
    req = extract_requirements_local("Busco algo para mi empresa")
    questions = clarification_questions(req)
    assert any("talento" in q.lower() or "servicio" in q.lower() for q in questions)


def test_clarification_questions_skip_category_when_known():
    req = extract_requirements_local("I need a photographer")
    questions = clarification_questions(req)
    assert not any("talent, a service" in q for q in questions)


def test_legacy_turn_greetings():
    assert is_legacy_turn("hi") is True
    assert is_legacy_turn("hello, what can you do?") is True
    assert is_legacy_turn("hola") is True


def test_legacy_turn_compare_and_person():
    assert is_legacy_turn("compare Alex and Maria") is True
    assert is_legacy_turn("Alex vs Maria, who is better?") is True
    assert is_legacy_turn("tell me more about @roger") is True
    assert is_legacy_turn("who is Maria?") is True


def test_discovery_turn_is_not_legacy():
    assert is_legacy_turn("I need a coffee supplier") is False
    assert is_legacy_turn("find me a React developer in Havana") is False


def test_summarize_offers_lists_only_given_offers():
    offers = [
        {"title": "Cuban coffee", "provider": {"displayName": "Café Sierra"},
         "category": "products", "city": "Santiago de Cuba"},
        {"title": "Rum tasting tour", "provider": {"displayName": "Ronera"},
         "category": "services", "city": "Havana"},
    ]
    text = summarize_offers_text(offers, "coffee")
    assert "Cuban coffee" in text
    assert "Café Sierra" in text
    assert "Rum tasting tour" in text
    # No invented availability / verification claims.
    assert "verified" not in text.lower()
    assert "available" not in text.lower()


def test_summarize_empty_offers_is_honest():
    text = summarize_offers_text([], "unobtainium")
    assert "couldn't find" in text.lower() or "no match" in text.lower()
