import requests

BASE_URL = "http://localhost:8000"
VECTORIZE_ENDPOINT = f"{BASE_URL}/api/vectorize"
TIMEOUT = 30

# Sample valid JWT token for authentication (replace with a valid test token)
VALID_JWT_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid_token_stub"
INVALID_JWT_TOKEN = "invalid.token.for.testing"

# Sample profile vectorization payload including text, YouTube video, image URLs and PDF metadata
sample_profile_payload = {
    "profile_text": {
        "bio": "Creative freelance graphic designer with 10 years experience.",
        "skills": ["Photoshop", "Illustrator", "UI/UX"],
        "passion": "Delivering inspiring visual content"
    },
    "youtube_videos": [
        {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
        {"url": "https://youtu.be/3JZ_D3ELwOQ"}
    ],
    "images": [
        {"url": "https://example.com/image1.jpg"},
        {"url": "https://example.com/image2.png"}
    ],
    "pdfs": [
        {"url": "https://example.com/portfolio.pdf", "description": "Portfolio document"}
    ]
}

def test_vectorize_endpoint_authentication_and_embedding_generation():
    # Test 1: Access without token should be forbidden/unauthorized
    response_no_auth = requests.post(
        VECTORIZE_ENDPOINT,
        json=sample_profile_payload,
        timeout=TIMEOUT,
    )
    assert response_no_auth.status_code in (401, 403), f"Expected 401 or 403 but got {response_no_auth.status_code}"
    
    # Test 2: Access with invalid token should be unauthorized
    headers_invalid = {"Authorization": f"Bearer {INVALID_JWT_TOKEN}"}
    response_invalid_auth = requests.post(
        VECTORIZE_ENDPOINT,
        headers=headers_invalid,
        json=sample_profile_payload,
        timeout=TIMEOUT,
    )
    assert response_invalid_auth.status_code == 401, f"Expected 401 for invalid token, got {response_invalid_auth.status_code}"
    
    # Test 3: Access with valid token should succeed and return embedding confirmation
    headers_valid = {"Authorization": f"Bearer {VALID_JWT_TOKEN}"}
    response_valid = requests.post(
        VECTORIZE_ENDPOINT,
        headers=headers_valid,
        json=sample_profile_payload,
        timeout=TIMEOUT,
    )
    assert response_valid.status_code == 200, f"Expected 200 OK, got {response_valid.status_code}"
    
    json_data = response_valid.json()
    
    # Validate response structure - expect keys related to embeddings and status
    assert "embedding_ids" in json_data, "Response missing 'embedding_ids'"
    embedding_ids = json_data["embedding_ids"]
    assert isinstance(embedding_ids, list) and len(embedding_ids) > 0, "Embedding IDs should be a non-empty list"
    
    assert "message" in json_data, "Response missing 'message'"
    assert "success" in json_data and json_data["success"] is True, "Response missing or false 'success' flag"

    # Optionally check embedding vector dimensions in detailed result if returned
    if "embeddings" in json_data:
        embeddings = json_data["embeddings"]
        assert isinstance(embeddings, list) and len(embeddings) > 0, "Embeddings should be a non-empty list"
        # Each embedding should be approx 768 dimension vector for Google Gemini AI
        for emb in embeddings:
            assert isinstance(emb, list), "Each embedding should be a list"
            assert len(emb) == 768, "Embedding vector length should be 768"

test_vectorize_endpoint_authentication_and_embedding_generation()
