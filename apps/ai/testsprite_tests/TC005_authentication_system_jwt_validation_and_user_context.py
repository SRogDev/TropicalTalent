import requests

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

VALID_JWT_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakepayload.fakesignature"
INVALID_JWT_TOKEN = "invalid.token.value"

def test_authentication_system_jwt_validation_and_user_context():
    headers_no_auth = {}
    headers_valid_auth = {"Authorization": f"Bearer {VALID_JWT_TOKEN}"}
    headers_invalid_auth = {"Authorization": f"Bearer {INVALID_JWT_TOKEN}"}

    # Use POST /api/vectorize endpoint which is protected and requires JWT and payload
    vectorize_endpoint = f"{BASE_URL}/api/vectorize"
    # Update payload to conform with expected structure containing profile_text
    valid_payload = {"profile_text": "Sample profile text for vectorization."}

    # 1. Test request without Authorization header (expect 401 Unauthorized)
    resp = requests.post(vectorize_endpoint, headers=headers_no_auth, json=valid_payload, timeout=TIMEOUT)
    assert resp.status_code == 401 or resp.status_code == 403, \
        f"Expected 401/403 Unauthorized for missing token, got {resp.status_code}"

    # 2. Test request with invalid token (expect 401 Unauthorized)
    resp = requests.post(vectorize_endpoint, headers=headers_invalid_auth, json=valid_payload, timeout=TIMEOUT)
    assert resp.status_code == 401 or resp.status_code == 403, \
        f"Expected 401/403 Unauthorized for invalid token, got {resp.status_code}"

    # 3. Test request with valid token (expect not 401/403, likely 200 or 422 depending on validation)
    resp = requests.post(vectorize_endpoint, headers=headers_valid_auth, json=valid_payload, timeout=TIMEOUT)
    assert resp.status_code != 401 and resp.status_code != 403, \
        f"With valid token, expected no 401/403 at POST /api/vectorize, got {resp.status_code}"

    # Optional: test GET /api/recommendations requires auth and returns 401 for missing token
    recommendations_endpoint = f"{BASE_URL}/api/recommendations"
    resp = requests.get(recommendations_endpoint, headers=headers_no_auth, timeout=TIMEOUT)
    assert resp.status_code == 401 or resp.status_code == 403 or resp.status_code == 400, \
        f"Expected 401/403/400 for missing token or invalid usage, got {resp.status_code}"

    resp = requests.get(recommendations_endpoint, headers=headers_invalid_auth, timeout=TIMEOUT)
    assert resp.status_code == 401 or resp.status_code == 403 or resp.status_code == 400, \
        f"Expected 401/403/400 for invalid token or invalid usage, got {resp.status_code}"

    # If valid token used with recommendations, expect 200 or 400 (if user searches not present)
    resp = requests.get(recommendations_endpoint, headers=headers_valid_auth, timeout=TIMEOUT)
    assert resp.status_code == 200 or resp.status_code == 400, \
        f"Expected 200 or 400 for valid token, got {resp.status_code}"


test_authentication_system_jwt_validation_and_user_context()
