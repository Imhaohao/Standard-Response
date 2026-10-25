import httpx

from rollcall_agent.models import Place

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim's usage policy requires an identifying User-Agent.
USER_AGENT = "rollcall-fetchai/0.1 (CalHacks 13 evacuation project)"


async def geocode(address: str, http: httpx.AsyncClient) -> Place | None:
    response = await http.get(
        NOMINATIM_URL,
        params={"q": address, "format": "jsonv2", "limit": 1, "countrycodes": "us"},
        headers={"User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    matches = response.json()
    if not matches:
        return None
    best = matches[0]
    return Place(lat=float(best["lat"]), lng=float(best["lon"]), display_name=best["display_name"])
