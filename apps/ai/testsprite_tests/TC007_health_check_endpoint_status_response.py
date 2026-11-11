import requests

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_health_check_endpoint_status_response():
    url = f"{BASE_URL}/health"
    try:
        response = requests.get(url, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request to /health endpoint failed: {e}"

    # Validate response status code
    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"

    # Validate response content type
    content_type = response.headers.get("Content-Type", "")
    assert "application/json" in content_type, f"Expected JSON response but got {content_type}"

    # Validate response JSON structure and keys
    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # Check for keys indicating service status, uptime, readiness
    assert isinstance(data, dict), "Response JSON is not an object"
    assert "status" in data, "Response JSON missing 'status' key"
    assert "uptime" in data, "Response JSON missing 'uptime' key"
    assert "ready" in data or "readiness" in data, "Response JSON missing readiness indicator"

    # Validate values (basic checks)
    assert isinstance(data["status"], str), "'status' should be a string"
    assert data["status"].lower() in ("ok", "healthy", "healthy", "up", "running"), "Unexpected status value"

    assert isinstance(data["uptime"], (int, float)), "'uptime' should be a number"
    assert data["uptime"] >= 0, "'uptime' should be non-negative"

    readiness_key = "ready" if "ready" in data else "readiness"
    readiness_value = data[readiness_key]
    assert isinstance(readiness_value, bool), f"'{readiness_key}' should be boolean"
    assert readiness_value is True, f"Service not ready according to '{readiness_key}'"

test_health_check_endpoint_status_response()