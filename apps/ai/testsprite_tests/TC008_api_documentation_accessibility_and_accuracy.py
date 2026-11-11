import requests

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_api_documentation_accessibility_and_accuracy():
    docs_url = f"{BASE_URL}/docs"
    redoc_url = f"{BASE_URL}/redoc"

    try:
        # Test /docs endpoint (Swagger UI)
        docs_response = requests.get(docs_url, timeout=TIMEOUT)
        assert docs_response.status_code == 200, f"/docs endpoint returned status {docs_response.status_code}"
        assert "Swagger UI" in docs_response.text or "swagger-ui" in docs_response.text.lower() or "<title>Swagger UI</title>" in docs_response.text, "Swagger UI not found in /docs response"

        # Check that API interactive testing UI elements exist in /docs page
        assert "try it out" in docs_response.text.lower() or "swagger-ui" in docs_response.text.lower(), "Interactive testing UI elements missing in /docs"

        # Test /redoc endpoint (ReDoc)
        redoc_response = requests.get(redoc_url, timeout=TIMEOUT)
        assert redoc_response.status_code == 200, f"/redoc endpoint returned status {redoc_response.status_code}"
        assert "ReDoc" in redoc_response.text or "redoc" in redoc_response.text.lower() or "<title>ReDoc</title>" in redoc_response.text, "ReDoc UI not found in /redoc response"

        # Check that ReDoc interactive UI elements exist in /redoc page
        assert "try it out" in redoc_response.text.lower() or "redoc" in redoc_response.text.lower(), "Interactive testing UI elements missing in /redoc"

    except requests.RequestException as e:
        assert False, f"Request to documentation endpoints failed: {e}"


test_api_documentation_accessibility_and_accuracy()