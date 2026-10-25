from datetime import datetime, timezone
from uuid import uuid4

from uagents_core.contrib.protocols.chat import ChatMessage, TextContent

from rollcall_agent.agent import build_agent, chat_reply, text_of
from rollcall_agent.understand import TOOL, from_tool_input


def test_chat_message_round_trips_text():
    message = ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(text="hello")])
    assert text_of(message) == "hello"
    assert text_of(chat_reply("hi")) == "hi"


def test_agent_builds_with_mailbox_and_chat_protocol(monkeypatch):
    monkeypatch.setenv("AGENT_SEED_PHRASE", "test seed phrase for the unit test only")
    monkeypatch.setenv("CONVEX_SITE_URL", "https://example.convex.site")
    monkeypatch.setenv("FETCH_AGENT_SECRET", "s")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    agent = build_agent()
    assert agent.address.startswith("agent1")
    assert any(spec.name == "AgentChatProtocol" for spec in [p for p in agent.protocols.values()])


def test_tool_output_with_unknown_kind_is_treated_as_other():
    assert from_tool_input({"kind": "delete everything"}).kind == "other"
    assert TOOL["input_schema"]["required"] == ["kind"]
