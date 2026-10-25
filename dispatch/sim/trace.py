"""An optional event log for one simulated night, used to write the replay files the map plays back.

Off unless `start()` is called, so the seed sweeps pay nothing for it. Recording never draws a random number,
so a traced run makes exactly the same choices as an untraced one.
"""

from __future__ import annotations

_events: list[tuple] | None = None


def start() -> None:
    global _events
    _events = []


def stop() -> list[tuple]:
    global _events
    events, _events = _events or [], None
    return events


def note(at: float, kind: str, *fields) -> None:
    if _events is not None:
        _events.append((float(at), kind, *fields))


def recording() -> bool:
    return _events is not None
