import os
from typing import Any, Protocol

from rollcall_agent.models import Understanding

MODEL = os.environ.get("CLAUDE_MODEL", "claude-haiku-5-5")

SYSTEM_PROMPT = (
    "You read one message sent to an evacuation-help agent. Decide what the person wants and fill the tool. "
    "kind=signup: they want someone (themselves or another person) signed up for the Ready check. "
    "kind=status: they ask whether an evacuation warning is active, for an address or in general. "
    "kind=other: anything else, including questions about other people's records. "
    "Only fill fields the message states. Never guess a phone number, address or need. "
    "Copy the phone number and street address exactly as written."
)

TOOL: dict[str, Any] = {
    "name": "record_request",
    "description": "Record what the message asks for.",
    "input_schema": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["signup", "status", "other"]},
            "address": {"type": "string"},
            "phone": {"type": "string", "description": "The household's own phone, as written."},
            "resident_name": {"type": "string"},
            "language": {"type": "string", "enum": ["en", "es", "zh", "ko", "vi", "tl", "ru", "ja", "fr", "hi"]},
            "mobility": {"type": "string", "enum": ["walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"]},
            "assistance_required": {"type": "string", "enum": ["none", "one_person_assist", "two_person_lift"]},
            "medical": {"type": "array", "items": {"type": "string", "enum": ["oxygen", "dialysis", "other"]}},
            "care": {
                "type": "array",
                "items": {"type": "string", "enum": ["hearing", "sight", "memory", "power_device", "service_animal"]},
            },
            "pets": {"type": "boolean"},
            "has_car": {"type": "boolean"},
            "people_count": {"type": "integer"},
            "exit_plan": {
                "type": "string",
                "enum": ["own_car", "helper", "needs_ride"],
                "description": "How they would leave: own car, someone agreed to pick them up, or they need a ride.",
            },
            "note": {"type": "string"},
        },
        "required": ["kind"],
    },
}


class MessagesClient(Protocol):
    def create(self, **kwargs: Any) -> Any: ...


def understand(client: MessagesClient, text: str) -> Understanding:
    response = client.create(
        model=MODEL,
        max_tokens=600,
        system=SYSTEM_PROMPT,
        tools=[TOOL],
        tool_choice={"type": "tool", "name": TOOL["name"]},
        messages=[{"role": "user", "content": text}],
    )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            return from_tool_input(block.input)
    return Understanding(kind="other")


def from_tool_input(data: dict[str, Any]) -> Understanding:
    kind = data.get("kind") if data.get("kind") in ("signup", "status") else "other"
    return Understanding(
        kind=kind,
        address=data.get("address"),
        phone=data.get("phone"),
        resident_name=data.get("resident_name"),
        language=data.get("language"),
        mobility=data.get("mobility"),
        assistance_required=data.get("assistance_required"),
        medical=list(data.get("medical") or []),
        care=list(data.get("care") or []),
        pets=data.get("pets"),
        has_car=data.get("has_car"),
        people_count=data.get("people_count"),
        exit_plan=data.get("exit_plan"),
        note=data.get("note"),
    )
