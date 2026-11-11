"""City name normalization service (UK only).

Resolves common UK city name aliases, abbreviations, and colloquial names
to canonical names so that Pinecone metadata filters on `city` are
consistent between vectorization time and search time.

The app is UK-only, so only British locations are covered.

Examples:
    "london" → "London"
    "brum" → "Birmingham"
    "edinburgh" → "Edinburgh"
"""

from __future__ import annotations

from app.core.logging import get_logger

logger = get_logger("services.city_normalizer")

# ---------------------------------------------------------------------------
# Alias dictionary: lowercased alias → canonical UK city/town name.
# Covers: major cities, common abbreviations, colloquial names, and
# frequent misspellings. Add entries as search insights reveal mismatches.
# ---------------------------------------------------------------------------
_CITY_ALIASES: dict[str, str] = {
    # ---- London ----
    "london": "London",
    "central london": "London",
    "greater london": "London",
    "city of london": "London",
    "east london": "London",
    "west london": "London",
    "north london": "London",
    "south london": "London",
    "londres": "London",  # Spanish

    # ---- Birmingham ----
    "birmingham": "Birmingham",
    "brum": "Birmingham",
    "brummagem": "Birmingham",
    "bham": "Birmingham",

    # ---- Manchester ----
    "manchester": "Manchester",
    "mcr": "Manchester",
    "manc": "Manchester",
    "greater manchester": "Manchester",

    # ---- Leeds ----
    "leeds": "Leeds",

    # ---- Liverpool ----
    "liverpool": "Liverpool",
    "l'pool": "Liverpool",
    "lpool": "Liverpool",

    # ---- Glasgow ----
    "glasgow": "Glasgow",
    "gla": "Glasgow",

    # ---- Edinburgh ----
    "edinburgh": "Edinburgh",
    "edi": "Edinburgh",
    "edinboro": "Edinburgh",
    "edinburg": "Edinburgh",  # Common misspelling

    # ---- Bristol ----
    "bristol": "Bristol",
    "bris": "Bristol",

    # ---- Sheffield ----
    "sheffield": "Sheffield",
    "sheff": "Sheffield",

    # ---- Newcastle ----
    "newcastle": "Newcastle",
    "newcastle upon tyne": "Newcastle",
    "newcastle-upon-tyne": "Newcastle",
    "ncl": "Newcastle",
    "toon": "Newcastle",

    # ---- Nottingham ----
    "nottingham": "Nottingham",
    "notts": "Nottingham",
    "nottm": "Nottingham",

    # ---- Cardiff ----
    "cardiff": "Cardiff",
    "caerdydd": "Cardiff",  # Welsh

    # ---- Belfast ----
    "belfast": "Belfast",

    # ---- Leicester ----
    "leicester": "Leicester",
    "leics": "Leicester",

    # ---- Coventry ----
    "coventry": "Coventry",
    "cov": "Coventry",

    # ---- Southampton ----
    "southampton": "Southampton",
    "soton": "Southampton",

    # ---- Brighton ----
    "brighton": "Brighton",
    "brighton and hove": "Brighton",
    "brighton & hove": "Brighton",
    "btn": "Brighton",

    # ---- Oxford ----
    "oxford": "Oxford",
    "oxon": "Oxford",

    # ---- Cambridge ----
    "cambridge": "Cambridge",
    "cambs": "Cambridge",

    # ---- Bath ----
    "bath": "Bath",

    # ---- York ----
    "york": "York",

    # ---- Aberdeen ----
    "aberdeen": "Aberdeen",

    # ---- Dundee ----
    "dundee": "Dundee",

    # ---- Swansea ----
    "swansea": "Swansea",
    "abertawe": "Swansea",  # Welsh

    # ---- Plymouth ----
    "plymouth": "Plymouth",

    # ---- Derby ----
    "derby": "Derby",

    # ---- Wolverhampton ----
    "wolverhampton": "Wolverhampton",
    "wolves": "Wolverhampton",

    # ---- Stoke-on-Trent ----
    "stoke-on-trent": "Stoke-on-Trent",
    "stoke on trent": "Stoke-on-Trent",
    "stoke": "Stoke-on-Trent",

    # ---- Sunderland ----
    "sunderland": "Sunderland",

    # ---- Reading ----
    "reading": "Reading",

    # ---- Bournemouth ----
    "bournemouth": "Bournemouth",

    # ---- Norwich ----
    "norwich": "Norwich",

    # ---- Exeter ----
    "exeter": "Exeter",

    # ---- Portsmouth ----
    "portsmouth": "Portsmouth",
    "pompey": "Portsmouth",

    # ---- Milton Keynes ----
    "milton keynes": "Milton Keynes",
    "mk": "Milton Keynes",

    # ---- Inverness ----
    "inverness": "Inverness",

    # ---- Stirling ----
    "stirling": "Stirling",

    # ---- Canterbury ----
    "canterbury": "Canterbury",

    # ---- Chester ----
    "chester": "Chester",

    # ---- Cheltenham ----
    "cheltenham": "Cheltenham",

    # ---- Ipswich ----
    "ipswich": "Ipswich",

    # ---- Northampton ----
    "northampton": "Northampton",

    # ---- Peterborough ----
    "peterborough": "Peterborough",

    # ---- Blackpool ----
    "blackpool": "Blackpool",

    # ---- Middlesbrough ----
    "middlesbrough": "Middlesbrough",
    "boro": "Middlesbrough",

    # ---- Huddersfield ----
    "huddersfield": "Huddersfield",

    # ---- Bradford ----
    "bradford": "Bradford",

    # ---- Luton ----
    "luton": "Luton",

    # ---- Croydon ----
    "croydon": "Croydon",

    # ---- Watford ----
    "watford": "Watford",

    # ---- Guildford ----
    "guildford": "Guildford",

    # ---- St Albans ----
    "st albans": "St Albans",
    "saint albans": "St Albans",

    # ---- Stratford-upon-Avon ----
    "stratford-upon-avon": "Stratford-upon-Avon",
    "stratford upon avon": "Stratford-upon-Avon",
    "stratford": "Stratford-upon-Avon",

    # ---- Colchester ----
    "colchester": "Colchester",

    # ---- Derry / Londonderry ----
    "derry": "Derry",
    "londonderry": "Derry",

    # ---- Lisburn ----
    "lisburn": "Lisburn",

    # ---- Bangor ----
    "bangor": "Bangor",

    # ---- Newport ----
    "newport": "Newport",

    # ---- Wrexham ----
    "wrexham": "Wrexham",
    "wrecsam": "Wrexham",  # Welsh
}


def normalize_city(city: str | None) -> str:
    """Return the canonical city name for a given alias or pass-through.

    The lookup is case-insensitive. If no alias matches, the original
    city string is returned title-cased (first letter of each word
    capitalized) so that novel cities still look clean in metadata.

    Args:
        city: Raw city name from user profile or search intent.

    Returns:
        Canonical city name, or title-cased original if no alias found.
        Empty string if input is falsy.
    """
    if not city or not city.strip():
        return ""

    key = city.strip().lower()

    # Exact alias match
    canonical = _CITY_ALIASES.get(key)
    if canonical:
        logger.debug("City alias resolved", raw=city, canonical=canonical)
        return canonical

    # No alias — return title-cased for consistency
    return city.strip().title()
