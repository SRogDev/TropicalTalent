import requests
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

# Protected endpoints and their methods with sample minimal requests to test rate limiting
PROTECTED_ENDPOINTS = [
    {
        "method": "POST",
        "url": f"{BASE_URL}/api/vectorize",
        "headers": {},  # Will add Authorization header if token is available
        "json": {
            "profile_id": "test-profile",
            "text": "Sample bio text for vectorization.",
            "youtube_urls": [],
            "image_urls": [],
            "pdf_urls": []
        }
    },
    {
        "method": "GET",
        "url": f"{BASE_URL}/api/recommendations",
        "headers": {},
        "params": {}
    },
    {
        "method": "POST",
        "url": f"{BASE_URL}/api/agent",
        "headers": {},
        "json": {
            "query": "Find creative talents for branding projects.",
            "conversation_id": None
        }
    }
]

# Unprotected endpoints to test rate limiting
UNPROTECTED_ENDPOINTS = [
    {
        "method": "GET",
        "url": f"{BASE_URL}/internals/search",
        "params": {"query": "graphic designer"}
    },
    {
        "method": "GET",
        "url": f"{BASE_URL}/health"
    },
    {
        "method": "GET",
        "url": f"{BASE_URL}/docs"
    },
    {
        "method": "GET",
        "url": f"{BASE_URL}/redoc"
    }
]

# Sample valid JWT token for testing (replace with a real token if available)
# We will attempt to get it from environment or set None to skip protected endpoints rate limit tests
import os
JWT_TOKEN = os.getenv("TEST_JWT_TOKEN")

def test_rate_limiting_enforcement_across_endpoints():
    headers_auth = {}
    if JWT_TOKEN:
        headers_auth = {"Authorization": f"Bearer {JWT_TOKEN}"}

    # Define a helper to send requests and return status and reason
    def send_request(method, url, headers=None, json=None, params=None):
        try:
            if method == "GET":
                return requests.get(url, headers=headers, params=params, timeout=TIMEOUT)
            elif method == "POST":
                return requests.post(url, headers=headers, json=json, params=params, timeout=TIMEOUT)
            else:
                raise ValueError(f"Unsupported HTTP method for test: {method}")
        except requests.exceptions.RequestException as e:
            return e

    # Rate limit test params
    normal_limit = 5        # Number of allowed calls before throttling might kick (assumption)
    burst_requests = 20     # Number of total calls to send rapidly to detect throttling
    
    # Testing unprotected endpoints rate limiting by rapid requests from same IP
    for ep in UNPROTECTED_ENDPOINTS:
        url = ep["url"]
        method = ep.get("method", "GET")
        params = ep.get("params")
        errors = 0
        throttled = False
        for i in range(burst_requests):
            resp = send_request(method, url, params=params)
            if isinstance(resp, Exception):
                errors += 1
                continue
            if resp.status_code == 429:
                throttled = True
                break
            # Allow normal responses (200/304/redirects...)
        msg = f"Rate limiting not enforced on unprotected endpoint {url}" if not throttled else None
        assert throttled, msg or f"Expected rate limiting (429) not triggered on {url}"

    # Testing protected endpoints rate limiting by rapid requests with auth
    if JWT_TOKEN:
        for ep in PROTECTED_ENDPOINTS:
            url = ep["url"]
            method = ep["method"]
            json_payload = ep.get("json")
            params_payload = ep.get("params")
            headers = headers_auth.copy()
            errors = 0
            throttled = False
            for i in range(burst_requests):
                resp = send_request(method, url, headers=headers, json=json_payload, params=params_payload)
                if isinstance(resp, Exception):
                    errors += 1
                    continue
                if resp.status_code == 429:
                    throttled = True
                    break
                # For protected endpoints also check 401 unauthorized if token invalid
                if resp.status_code == 401:
                    raise AssertionError(f"Authentication failed for protected endpoint {url} with provided token")
            msg = f"Rate limiting not enforced on protected endpoint {url}" if not throttled else None
            assert throttled, msg or f"Expected rate limiting (429) not triggered on {url}"

    else:
        # If no JWT token, skip protected endpoints test but assert at least unprotected passed
        # Nothing else to assert here as no token provided
        pass

    # Normal usage check: few calls should not be throttled
    # Test 3 requests with small delay to ensure allowed usage is not blocked
    for ep in UNPROTECTED_ENDPOINTS:
        url = ep["url"]
        method = ep.get("method", "GET")
        params = ep.get("params")
        for _ in range(3):
            resp = send_request(method, url, params=params)
            assert not (isinstance(resp, Exception) or resp.status_code == 429), \
                f"Normal usage incorrectly throttled on unprotected endpoint {url}"
            time.sleep(0.1)

    if JWT_TOKEN:
        for ep in PROTECTED_ENDPOINTS:
            url = ep["url"]
            method = ep["method"]
            json_payload = ep.get("json")
            headers = headers_auth.copy()
            for _ in range(3):
                resp = send_request(method, url, headers=headers, json=json_payload)
                assert not (isinstance(resp, Exception) or resp.status_code == 429), \
                    f"Normal usage incorrectly throttled on protected endpoint {url}"
                time.sleep(0.1)

test_rate_limiting_enforcement_across_endpoints()