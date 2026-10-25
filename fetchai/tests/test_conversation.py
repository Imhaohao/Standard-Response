import json
from types import SimpleNamespace

import httpx
import pytest

from rollcall_agent.conversation import Conversation
from rollcall_agent.convex_client import ConvexClient

NOMINATIM = [{"lat": "34.1952343", "lon": "-118.1579633", "display_name": "486, West Mariposa Street, Altadena, California"}]


class FakeClaude:
    """Stands in for anthropic.Anthropic().messages: returns the tool input it was given."""

    def __init__(self, *tool_inputs: dict):
        self.tool_inputs = list(tool_inputs)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        block = SimpleNamespace(type="tool_use", input=self.tool_inputs.pop(0))
        return SimpleNamespace(content=[block])


def build(claude: FakeClaude, status: dict | None = None, geocode_hits=NOMINATIM):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "nominatim" in request.url.host:
            return httpx.Response(200, json=geocode_hits)
        if request.url.path == "/agent/status":
            return httpx.Response(200, json=status)
        return httpx.Response(200, json={"status": "received"})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    convex = ConvexClient("https://example.convex.site", "s3cret", http)
    return Conversation(claude, convex, http), seen


SIGNUP = {
    "kind": "signup",
    "address": "486 W Mariposa St, Altadena",
    "phone": "626-555-0101",
    "resident_name": "Mom",
    "mobility": "walker",
    "exit_plan": "needs_ride",
}


def convex_calls(seen):
    return [r for r in seen if r.url.host == "example.convex.site"]


async def test_signup_confirms_back_then_calls_convex_only_after_yes():
    conversation, seen = build(FakeClaude(SIGNUP))
    proposal = await conversation.reply("asi", "my mom at 486 W Mariposa uses a walker, 626-555-0101, she needs a ride")
    assert "Shall I sign them up" in proposal and "walker" in proposal
    assert convex_calls(seen) == []

    done = await conversation.reply("asi", "yes")
    assert "signed up" in done
    (call,) = convex_calls(seen)
    assert call.url.path == "/agent/ready-signup"
    assert call.headers["authorization"] == "Bearer s3cret"
    body = json.loads(call.content)
    assert body["lat"] == pytest.approx(34.1952343) and body["exitPlan"] == "needs_ride" and body["mobility"] == "walker"


async def test_no_cancels_and_saves_nothing():
    conversation, seen = build(FakeClaude(SIGNUP))
    await conversation.reply("asi", "sign up my mom")
    assert "Nothing was saved" in await conversation.reply("asi", "no")
    assert convex_calls(seen) == []


async def test_missing_fields_are_asked_for_before_any_lookup():
    conversation, seen = build(FakeClaude({"kind": "signup", "address": "486 W Mariposa St"}))
    answer = await conversation.reply("asi", "sign up my mom at 486 W Mariposa")
    assert "phone number" in answer and "how they would leave" in answer
    assert seen == []


async def test_confirmation_is_per_sender():
    conversation, seen = build(FakeClaude(SIGNUP, {"kind": "other"}))
    await conversation.reply("alice", "sign up mom")
    await conversation.reply("bob", "yes")
    assert convex_calls(seen) == []


async def test_status_for_an_address_returns_public_guidance_only():
    status = {"warningActive": True, "coversPlace": True, "guidance": "An evacuation warning is active. If you can leave safely, leave now.", "evacuationLine": "+16265550100"}
    conversation, seen = build(FakeClaude({"kind": "status", "address": "486 W Mariposa St, Altadena"}), status)
    answer = await conversation.reply("asi", "is there a warning at 486 W Mariposa?")
    assert "inside the warning area" in answer and "leave now" in answer and "+16265550100" in answer
    (call,) = convex_calls(seen)
    assert json.loads(call.content) == {"lat": pytest.approx(34.1952343), "lng": pytest.approx(-118.1579633)}


async def test_unknown_address_is_reported_not_guessed():
    conversation, seen = build(FakeClaude({"kind": "status", "address": "nowhere"}), geocode_hits=[])
    assert "could not find that address" in await conversation.reply("asi", "warning at nowhere?")
    assert convex_calls(seen) == []


async def test_questions_about_other_people_get_the_menu_and_no_network_call():
    conversation, seen = build(FakeClaude({"kind": "other"}))
    answer = await conversation.reply("asi", "who else is on the list on Mariposa St?")
    assert "I never share anything about anyone" in answer
    assert seen == []


async def test_convex_outage_gives_safe_fallback():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=NOMINATIM) if "nominatim" in request.url.host else httpx.Response(500)

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    conversation = Conversation(FakeClaude({"kind": "status"}), ConvexClient("https://x.convex.site", "k", http), http)
    assert "call 911" in await conversation.reply("asi", "any warning?")
