"""The voice agent's fixed lines, read from voice/agent/lines/<language>.ts.

The eval and the grader compare agent replies against these sentences (status templates, the safety line,
"nothing has changed", the hold steps). Reading them from Track B's source keeps the comparison true when
the wording changes, instead of drifting from a copy. Only plain string values are read: a key whose
value is a function (`confirmAddress: (address) => ...`) is skipped.
"""

import json
import re
import uuid
from functools import cache

from .paths import REPO

LINES_DIR = REPO / "voice" / "agent" / "lines"
CONVERSATION = REPO / "voice" / "agent" / "conversation.ts"
HAZARD = "wildfire"  # the hazard the persona and alignment evals run under

_STRING = r'"(?:[^"\\]|\\.)*"'
_KEY = re.compile(r"^(\s*)(\w+):\s*(.*)$")


def _string(literal: str) -> str:
    return json.loads(literal)


def _block_end(lines: list[str], start: int, indent: int) -> int:
    """Index of the line that closes the object or array opened on line `start`."""
    for i in range(start + 1, len(lines)):
        stripped = lines[i].strip()
        if stripped and len(lines[i]) - len(lines[i].lstrip()) <= indent and stripped[0] in "}]":
            return i
    return len(lines)


def _parse_block(lines: list[str], indent: int) -> dict:
    """Keys at exactly `indent` spaces, with string, string-array or nested-object values."""
    values: dict = {}
    i = 0
    while i < len(lines):
        m = _KEY.match(lines[i])
        if not m or len(m.group(1)) != indent:
            i += 1
            continue
        key, rest = m.group(2), m.group(3).strip()
        if rest in ("{", "["):
            end = _block_end(lines, i, indent)
            body = lines[i + 1:end]
            values[key] = _parse_block(body, indent + 2) if rest == "{" else [_string(s) for s in re.findall(_STRING, "\n".join(body))]
            i = end + 1
            continue
        if not rest and i + 1 < len(lines):  # the value sits on the next line
            rest = lines[i + 1].strip()
            i += 1
        literal = re.fullmatch(rf"({_STRING}),?", rest)
        if literal:
            values[key] = _string(literal.group(1))
        i += 1
    return values


@cache
def lines_for(language: str) -> dict:
    """Every plain-string line in voice/agent/lines/<language>.ts, by key. Empty if the file is missing."""
    path = LINES_DIR / f"{language}.ts"
    if not path.exists():
        return {}
    source = path.read_text().splitlines()
    start = next((i for i, line in enumerate(source) if re.match(r"export const \w+: Lines = \{", line)), None)
    if start is None:
        return {}
    return _parse_block(source[start + 1:], 2)


def with_safety(line: str, language: str) -> str:
    """As voice/agent/script.ts withSafety: the line, then the hazard's safety sentence."""
    lines = lines_for(language)
    return f"{line}{lines.get('sentenceGap', ' ')}{lines['safety'][HAZARD]}"


def recent_agent_turns() -> int:
    """How many agent turns back a status line still counts as just heard (conversation.ts RECENT_AGENT_TURNS)."""
    found = CONVERSATION.exists() and re.search(r"const RECENT_AGENT_TURNS = (\d+);", CONVERSATION.read_text())
    return int(found.group(1)) if found else 3


# POST /turn speaks for the hazard picked on the shared call floor (voice/hazard.ts), not one the eval chooses. The cards
# and the status lines the evals expect are for HAZARD, so a call that spoke another hazard's safety line isn't scored.


def hazards_spoken(texts: list[str], language: str) -> set[str]:
    safety = lines_for(language).get("safety", {})
    return {hazard for hazard, line in safety.items() if any(line in text for text in texts)}


def probe_hazard(agent) -> str | None:
    """The hazard the agent speaks for right now: one call with a ride on the list, asked about the ride."""
    body = {"sessionId": f"hazard-probe-{uuid.uuid4().hex[:8]}", "language": "en", "text": "", "requestStatus": "received"}
    agent.turn(body)
    reply = agent.turn({**body, "text": "Is someone coming to get me?"})["reply"]
    spoken = hazards_spoken([reply], "en")
    return min(spoken) if len(spoken) == 1 else None
