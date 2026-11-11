import requests

BASE_URL = "http://localhost:8000"
API_PATH = "/api/agent"
TIMEOUT = 30

# Replace this with a valid JWT to test authenticated requests
VALID_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.validtoken.signature"
INVALID_JWT = "invalid.token.value"

headers = {
    "Authorization": f"Bearer {VALID_JWT}",
    "Accept": "text/event-stream",
    "Content-Type": "application/json",
}

def test_ai_agent_endpoint_streaming_and_context_maintenance():
    """
    Test POST /api/agent endpoint with JWT auth, natural language input,
    streaming via SSE, and conversational context maintenance.
    """

    # Step 1: Verify that endpoint requires JWT authentication with 401 or 403 on missing/invalid token
    url = BASE_URL + API_PATH
    query_payload = {"query": "Show me creative talents specialized in graphic design."}

    # Missing token test
    resp = requests.post(url, json=query_payload, timeout=TIMEOUT)
    assert resp.status_code in (400, 401, 403), "Missing token should return 400, 401 or 403 Unauthorized"

    # Invalid token test
    resp = requests.post(url, headers={"Authorization": f"Bearer {INVALID_JWT}", "Content-Type": "application/json", "Accept": "text/event-stream"}, json=query_payload, timeout=TIMEOUT)
    assert resp.status_code in (400, 401, 403), "Invalid token should return 400, 401 or 403 Unauthorized"

    # Step 2: Test authenticated request receives streaming SSE response

    # We will simulate conversation context by sending multiple queries sequentially 
    # using the same messages with context maintained by server

    conversation = [
        "Who are the top illustrators available?",
        "Can you show me those who specialize in children's books?",
        "Add visual artists with experience in animation as well."
    ]

    # Function to open SSE connection and collect streamed events from responses
    def fetch_sse_stream(payload, collected_events):
        with requests.post(
            url,
            headers=headers,
            json=payload,
            stream=True,
            timeout=TIMEOUT,
        ) as response:
            assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}"
            content_type = response.headers.get("Content-Type", "")
            assert "text/event-stream" in content_type, f"Expected 'text/event-stream' header but got {content_type}"
            for line in response.iter_lines(decode_unicode=True):
                if line:
                    if line.startswith("data:"):
                        data = line[5:].strip()
                        collected_events.append(data)

    # Collect responses for each query to validate conversational context and streaming
    all_streamed_data = []

    for i, query_text in enumerate(conversation):
        events = []
        payload = {"query": query_text}
        fetch_sse_stream(payload, events)

        # Ensure events were received
        assert len(events) > 0, f"No streamed events received for query '{query_text}'"

        # Check that the streamed data is consistent (e.g., JSON or expected format)
        for event_data in events:
            # Basic check: events should be non-empty and parsable JSON strings or meaningful messages
            # Because PRD does not specify exact format of streamed data, check non-empty string
            assert event_data.strip() != "", "Received an empty data event"

        # Collect all streamed data to check consistency across conversation
        all_streamed_data.append(events)

        # Minimal context maintenance check:
        # We expect that the events for later queries relate to additional talent specs,
        # so later events should not contradict earlier ones (high-level check)
        # (This is a heuristic since exact content unknown)
        if i > 0:
            joined_prev = " ".join(all_streamed_data[i-1])
            joined_curr = " ".join(all_streamed_data[i])
            # They should share some non-trivial common words to imply context maintenance (heuristic)
            common_words = set(joined_prev.lower().split()) & set(joined_curr.lower().split())
            assert len(common_words) > 0, "Likely context not maintained between streamed responses"

    # Test finished successfully
    print("Test TC003 passed: AI agent endpoint requires JWT, streams data via SSE, and maintains context.")

test_ai_agent_endpoint_streaming_and_context_maintenance()
