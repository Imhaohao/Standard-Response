"""Settings from the environment or the repository's .env.local (the shared env file).

A real environment variable wins over the file, so a one-off `export` still overrides it.
"""

import os
from functools import lru_cache

from .paths import REPO


@lru_cache(maxsize=1)
def _file_values() -> dict[str, str]:
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


def env_value(*keys: str) -> str | None:
    """The first of `keys` that is set, checking the environment before .env.local."""
    for key in keys:
        value = os.environ.get(key) or _file_values().get(key)
        if value:
            return value
    return None
