"""RED tests — Phase 4 Team Search CRM handoff decision.

Decision (recorded in docs/architecture/ai-orchestration.md §4 and
docs/architecture/data-model.md): the Team Search graph's
`project_creator` and `persuasion_agent` nodes are DISABLED, not fixed
by creating the legacy `projects` / `project_members` / `connections` /
`messages` tables. Creating those tables would resurrect a second,
parallel project model that nothing in the web reads — orphaned writes
under a `projects` name that collides with `tropical_projects` — while
the Cubora commercial operation is the negotiation, owned by the Phase 4
CRM. Approval of a reviewed team therefore ends the graph at a
`crm_handoff` node: status `complete`, no Supabase write, and a message
telling the user Cubora operations will open the commercial operation.

Tests before implementation:
- approval after reviewing routes to `crm_handoff`, never to
  `project_creator` or `persuasion_agent`, in both create and update mode
- the handoff node returns status `complete` with no project_id and a
  message naming the operations handoff
- the compiled graph contains `crm_handoff` and no longer contains
  `project_creator` or `persuasion_agent`
"""

from langchain_core.messages import HumanMessage


def test_approval_routes_to_crm_handoff_in_create_mode():
    from app.services.team_search.graph import route_after_review

    state = {
        "messages": [HumanMessage(content="yes, looks good")],
        "mode": "create",
    }
    assert route_after_review(state) == "crm_handoff"


def test_approval_routes_to_crm_handoff_in_update_mode():
    from app.services.team_search.graph import route_after_review

    state = {
        "messages": [HumanMessage(content="approved, go ahead")],
        "mode": "update",
    }
    assert route_after_review(state) == "crm_handoff"


def test_analysis_still_routes_to_people_analyst():
    from app.services.team_search.graph import route_after_review

    state = {
        "messages": [HumanMessage(content="tell me more about the second one")],
        "mode": "create",
    }
    assert route_after_review(state) == "people_analyst"


async def test_crm_handoff_node_completes_without_supabase():
    from app.services.team_search.graph import crm_handoff_node

    result = await crm_handoff_node(
        {
            "project_name": "Coffee export crew",
            "selected_team": [{"username": "ana", "role": "producer"}],
        }
    )
    assert result["status"] == "complete"
    assert result.get("project_id") is None
    assert result["messages"], "the handoff must explain itself to the user"
    text = result["messages"][0].content
    assert "operations" in text.lower()


def test_compiled_graph_has_handoff_and_no_legacy_create_nodes():
    from app.services.team_search.graph import get_team_search_graph

    graph = get_team_search_graph()
    nodes = set(graph.nodes)
    assert "crm_handoff" in nodes
    assert "project_creator" not in nodes
    assert "persuasion_agent" not in nodes
