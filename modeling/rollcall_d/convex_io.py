"""Convex access for Track D's scripts.

The deployment URL comes from CONVEX_URL, or NEXT_PUBLIC_CONVEX_URL, in the environment or in the
repository's .env.local (the shared env file). Python ints become Convex int64, which `v.number()`
rejects, so every number we send goes through `as_float`.
"""

import os
from typing import Any

from convex import ConvexClient

from .paths import REPO

URL_KEYS = ("CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL")


def _env_file_values() -> dict[str, str]:
    path = REPO / ".env.local"
    if not path.exists():
        return {}
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def convex_url() -> str:
    file_values = _env_file_values()
    for key in URL_KEYS:
        value = os.environ.get(key) or file_values.get(key)
        if value:
            return value
    raise RuntimeError("Set CONVEX_URL (or put the shared env file at .env.local in the repo root)")


def as_float(value: Any) -> Any:
    """Recursively turn ints into floats so Convex sees `number`, not `int64`. Booleans stay booleans."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return float(value)
    if isinstance(value, dict):
        return {k: as_float(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_float(v) for v in value]
    return value


class Convex:
    def __init__(self, url: str | None = None):
        self.url = url or convex_url()
        self.client = ConvexClient(self.url)

    def query(self, name: str, args: dict | None = None) -> Any:
        return self.client.query(name, as_float(args or {}))

    def mutation(self, name: str, args: dict | None = None) -> Any:
        return self.client.mutation(name, as_float(args or {}))

    def batched(self, name: str, key: str, rows: list[dict], size: int = 200) -> None:
        for start in range(0, len(rows), size):
            self.mutation(name, {key: rows[start : start + size]})
