import re
from dataclasses import dataclass, field

import httpx

from rollcall_agent.convex_client import ConvexClient
from rollcall_agent.geocode import geocode
from rollcall_agent.models import PendingSignup, Understanding
from rollcall_agent.understand import MessagesClient, understand

YES = {"yes", "y", "yeah", "yep", "confirm", "confirmed", "correct", "ok", "okay", "sure", "si"}
NO = {"no", "n", "nope", "cancel", "stop", "wrong"}
GREETING = (
    "I can do two things. (1) Sign someone up for the Ready evacuation check: tell me their address, "
    "their phone number, and how they would leave (own car, a person who agreed to drive them, or they need a ride). "
    "(2) Tell you whether an evacuation warning is active, for an address or in general. "
    "I never share anything about anyone who is signed up."
)
NOT_FOUND = "I could not find that address. Please send the full street address with the city, for example '486 W Mariposa St, Altadena'."
LOOKUP_FAILED = "I could not look up that address right now. Please try again in a minute."
UNAVAILABLE = "I could not reach the evacuation system just now. If this is urgent, call 911. If you can leave safely, leave now."


def first_word(text: str) -> str:
    words = re.findall(r"\w+", text.lower())
    return words[0] if words else ""


def describe(pending: PendingSignup) -> str:
    u = pending.understanding
    needs = [x for x in [u.mobility, u.assistance_required, *u.medical, *u.care] if x and x != "none"]
    lines = [
        f"Name: {u.resident_name or 'not given'}",
        f"Address: {u.address} (map match: {pending.place.display_name})",
        f"Phone: {u.phone}",
        f"How they would leave: {u.exit_plan}",
        f"Needs: {', '.join(needs) if needs else 'none given'}",
    ]
    return "\n".join(lines)


def missing_fields(u: Understanding) -> list[str]:
    missing = []
    if not u.address:
        missing.append("the street address")
    if not u.phone:
        missing.append("the phone number where the household can be reached")
    if not u.exit_plan:
        missing.append("how they would leave (own car, a person who agreed to drive them, or they need a ride)")
    return missing


def format_status(status: dict, address: str | None) -> str:
    parts = [status["guidance"]]
    covers = status.get("coversPlace")
    if address and status["warningActive"] and covers is not None:
        parts.insert(0, f"{address} is {'inside' if covers else 'outside'} the warning area.")
    if status.get("evacuationLine"):
        parts.append(f"Evacuation line: {status['evacuationLine']}.")
    return " ".join(parts)


@dataclass
class Conversation:
    claude: MessagesClient
    convex: ConvexClient
    http: httpx.AsyncClient
    pending: dict[str, PendingSignup] = field(default_factory=dict)

    async def reply(self, sender: str, text: str) -> str:
        if sender in self.pending:
            answer = await self._answer_confirmation(sender, text)
            if answer is not None:
                return answer
        understanding = understand(self.claude, text)
        if understanding.kind == "signup":
            return await self._propose_signup(sender, understanding)
        if understanding.kind == "status":
            return await self._status(understanding)
        return GREETING

    async def _answer_confirmation(self, sender: str, text: str) -> str | None:
        word = first_word(text)
        if word in NO:
            del self.pending[sender]
            return "Okay, I did not sign anyone up. Nothing was saved."
        if word not in YES:
            return None
        pending = self.pending.pop(sender)
        try:
            await self.convex.sign_up(pending)
        except httpx.HTTPError:
            return UNAVAILABLE
        return (
            f"Done. {pending.understanding.address} is signed up for the Ready check. "
            "It stays unverified until the evacuation line calls that number to confirm. "
            "I cannot show anyone's records, including this one."
        )

    async def _propose_signup(self, sender: str, understanding: Understanding) -> str:
        missing = missing_fields(understanding)
        if missing:
            return "To sign them up I still need: " + "; ".join(missing) + "."
        try:
            place = await geocode(understanding.address or "", self.http)
        except httpx.HTTPError:
            return LOOKUP_FAILED
        if place is None:
            return NOT_FOUND
        pending = PendingSignup(understanding, place)
        self.pending[sender] = pending
        return f"Here is what I understood:\n{describe(pending)}\n\nShall I sign them up? Reply yes or no."

    async def _status(self, understanding: Understanding) -> str:
        lat = lng = None
        if understanding.address:
            try:
                place = await geocode(understanding.address, self.http)
            except httpx.HTTPError:
                return LOOKUP_FAILED
            if place is None:
                return NOT_FOUND
            lat, lng = place.lat, place.lng
        try:
            status = await self.convex.status(lat, lng)
        except httpx.HTTPError:
            return UNAVAILABLE
        return format_status(status, understanding.address)
