import requests

BASE_URL = "http://localhost:8000"
RECOMMENDATIONS_ENDPOINT = f"{BASE_URL}/api/recommendations"
VECTORIZE_ENDPOINT = f"{BASE_URL}/api/vectorize"
SEARCH_LOG_ENDPOINT = f"{BASE_URL}/api/searchlogs"  # Assuming search logs can be created/deleted via an endpoint for the test or use the vectorize endpoint to simulate searches
TOKEN_AUTH_ENDPOINT = f"{BASE_URL}/auth/token"  # Hypothetical endpoint to obtain JWT for testing auth
TIMEOUT = 30

# For testing purpose, use hardcoded test user credentials or a fixture to get valid JWT token
TEST_USER_CREDENTIALS = {"email": "testuser@example.com", "password": "testpassword"}

def get_jwt_token():
    """
    This function simulates logging in or obtaining a JWT token for authentication.
    Since the PRD mentions Supabase Auth with JWT bearer tokens,
    this test assumes an auth endpoint exists that returns a JWT token on valid credentials.
    Adjust as needed to actual auth implementation.
    """
    try:
        resp = requests.post(TOKEN_AUTH_ENDPOINT, json=TEST_USER_CREDENTIALS, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token") or data.get("token") or data.get("accessToken")
        assert token is not None, "No access token returned from login endpoint."
        return token
    except requests.RequestException as e:
        assert False, f"Authentication token retrieval failed, skipping test: {e}"

def create_search_log(jwt_token, search_text):
    """
    Create a search log that simulates a user search.
    Use this to generate last 21 vectors for recommendations.
    Assumes an endpoint or method to create search logs.
    If no such endpoint exists, this step must be adapted.
    """
    headers = {"Authorization": f"Bearer {jwt_token}"}
    payload = {"query": search_text}
    try:
        resp = requests.post(f"{BASE_URL}/api/searchlogs", json=payload, headers=headers, timeout=TIMEOUT)
        resp.raise_for_status()
        log_id = resp.json().get("id")
        assert log_id is not None, "Search log creation did not return an ID."
        return log_id
    except requests.RequestException as e:
        assert False, f"Could not create search log: {e}"

def delete_search_log(jwt_token, log_id):
    """
    Cleanup search log after test if possible.
    Assumes DELETE /api/searchlogs/{id} endpoint exists.
    """
    headers = {"Authorization": f"Bearer {jwt_token}"}
    try:
        requests.delete(f"{BASE_URL}/api/searchlogs/{log_id}", headers=headers, timeout=TIMEOUT)
        # Not critical if deletion fails, so no raise_for_status here
    except requests.RequestException:
        pass


def test_smart_recommendations_endpoint_relevance_and_authentication():
    token = get_jwt_token()
    headers = {"Authorization": f"Bearer {token}"}

    # Test 1: Access without auth token - expect 401 Unauthorized
    resp_unauth = requests.get(RECOMMENDATIONS_ENDPOINT, timeout=TIMEOUT)
    assert resp_unauth.status_code == 401 or resp_unauth.status_code == 403, \
        "Request without JWT token must be rejected with 401 or 403 status."

    # Prepare 21 search logs to simulate last searches for average vector calculation
    search_ids = []
    try:
        for i in range(21):
            search_text = f"test search query {i}"
            log_id = create_search_log(token, search_text)
            assert log_id is not None, f"Failed to create search log for query '{search_text}'."
            search_ids.append(log_id)

        # Now call recommendations endpoint with auth
        resp = requests.get(RECOMMENDATIONS_ENDPOINT, headers=headers, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        # Validate response format and contents
        # Expect top 7 matches with metadata
        assert isinstance(data, dict), "Response should be a JSON object."
        matches = data.get("matches") or data.get("results") or data.get("recommendations")
        assert matches is not None, "Response missing recommendations/matches field."
        assert isinstance(matches, list), "Recommendations should be a list."
        assert 1 <= len(matches) <= 7, "Should return up to 7 top matches."

        # Check each match for required metadata fields
        required_fields = {"id", "name", "similarity_score", "metadata"}
        for match in matches:
            assert isinstance(match, dict), "Each match should be a dict."
            keys = set(match.keys())
            assert required_fields.issubset(keys), f"Match missing required fields: {required_fields - keys}"
            # similarity_score should be a float between 0 and 1 (or similarity metric range)
            sim_score = match.get("similarity_score")
            assert isinstance(sim_score, (float, int)), "similarity_score must be a number."
            assert 0 <= sim_score <= 1, "similarity_score must be between 0 and 1."

            metadata = match.get("metadata")
            assert isinstance(metadata, dict), "metadata must be a dictionary."

    finally:
        # Cleanup created search logs
        for log_id in search_ids:
            delete_search_log(token, log_id)


test_smart_recommendations_endpoint_relevance_and_authentication()
