from dataclasses import dataclass, field
from typing import Literal

Kind = Literal["signup", "status", "other"]
ExitPlan = Literal["own_car", "helper", "needs_ride"]


@dataclass
class Understanding:
    kind: Kind
    address: str | None = None
    phone: str | None = None
    resident_name: str | None = None
    language: str | None = None
    mobility: str | None = None
    assistance_required: str | None = None
    medical: list[str] = field(default_factory=list)
    care: list[str] = field(default_factory=list)
    pets: bool | None = None
    has_car: bool | None = None
    people_count: int | None = None
    exit_plan: ExitPlan | None = None
    note: str | None = None


@dataclass
class Place:
    lat: float
    lng: float
    display_name: str


@dataclass
class PendingSignup:
    understanding: Understanding
    place: Place
