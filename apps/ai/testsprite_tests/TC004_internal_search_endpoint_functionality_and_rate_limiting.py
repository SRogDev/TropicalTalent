import requests
import time

BASE_URL = "http://localhost:8000"
SEARCH_ENDPOINT = f"{BASE_URL}/internals/search"
TIMEOUT = 30


def test_internal_search_endpoint_rate_limiting():
    query_params = {"q": "creative professional vector search"}

    headers = {
        "Accept": "application/json",
    }

    # 1. Test successful search request without authentication
    try:
        response = requests.get(SEARCH_ENDPOINT, params=query_params, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"
    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}"
    try:
        json_data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # Validate keys that indicate semantic search and embeddings usage (heuristic check)
    # Example expected keys might be 'results', 'query_embedding' or similar according to typical semantic search responses
    assert isinstance(json_data, dict), "Response JSON is not a dict"
    assert "results" in json_data, "Response JSON missing 'results' key"
    assert isinstance(json_data["results"], list), "'results' should be a list"

    # 2. Authentication not required - verify via no Authorization header and still success above
    # (Already tested by making request without auth)

    # 3. Rate limiting enforcement
    # Make rapid repeated requests to exceed rate limit and verify HTTP 429 response

    max_requests = 15  # Assumed rate limit threshold (adjust as needed)
    success_count = 1  # We already made 1 request
    rate_limited = False
    last_response = None

    for i in range(max_requests):
        try:
            r = requests.get(SEARCH_ENDPOINT, params=query_params, headers=headers, timeout=TIMEOUT)
            last_response = r
            if r.status_code == 429:
                rate_limited = True
                break
            elif r.status_code != 200:
                # Unexpected non-200/429 status
                assert False, f"Unexpected status code during rate limiting test: {r.status_code}"
            else:
                success_count += 1
        except requests.RequestException as e:
            assert False, f"Request during rate limiting test failed: {e}"
        # small sleep to simulate rapid calls but still likely to hit rate limits if configured low
        time.sleep(0.1)

    assert rate_limited, (
        f"Expected to receive HTTP 429 Too Many Requests due to rate limiting, "
        f"but did not. Successful requests before limit reached: {success_count}"
    )

    # Optionally validate Retry-After header or rate limit headers if present
    if last_response is not None:
        retry_after = last_response.headers.get("Retry-After")
        if retry_after is not None:
            try:
                retry_seconds = int(retry_after)
                assert retry_seconds > 0, "Retry-After header value should be positive"
            except ValueError:
                assert False, "Retry-After header is not a valid integer"


test_internal_search_endpoint_rate_limiting()