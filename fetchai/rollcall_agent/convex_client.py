from dataclasses import dataclass
from typing import Any

import httpx

from rollcall_agent.models import PendingSignup


@dataclass
class ConvexClient:
    site_url: str
    secret: str
    http: httpx.AsyncClient

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = await self.http.post(
            f"{self.site_url.rstrip('/')}{path}",
            json=body,
            headers={"Authorization": f"Bearer {self.secret}"},
            timeout=20,
        )
        response.raise_for_status()
        return response.json()

    async def sign_up(self, pending: PendingSignup) -> dict[str, Any]:
        return await self._post("/agent/ready-signup", signup_body(pending))

    async def status(self, lat: float | None, lng: float | None) -> dict[str, Any]:
        body = {} if lat is None or lng is None else {"lat": lat, "lng": lng}
        return await self._post("/agent/status", body)


def signup_body(pending: PendingSignup) -> dict[str, Any]:
    u = pending.understanding
    fields = {
        "phone": u.phone,
        "address": u.address,
        "lat": pending.place.lat,
        "lng": pending.place.lng,
        "language": u.language or "en",
        "exitPlan": u.exit_plan,
        "residentName": u.resident_name,
        "mobility": u.mobility,
        "assistanceRequired": u.assistance_required,
        "medical": u.medical,
        "care": u.care,
        "pets": u.pets,
        "hasCar": u.has_car,
        "peopleCount": u.people_count,
        "note": u.note,
    }
    return {key: value for key, value in fields.items() if value is not None}
