"""Door-check queue: calls scale, door-knock teams don't, so the order of visits matters.

    priority_h = (p_h * u_h) / tau_h + alpha * wait_h

  p_h     need estimate (rollcall_d.need)
  u_h     urgency: 60 / max(minutes of slack before the hazard deadline, MIN_SLACK). 1.0 means an hour left.
  tau_h   minutes for the nearest team to drive there on the road graph, closures removed
  wait_h  minutes on the list. The aging term guarantees nobody, however isolated, stays last forever.
  alpha   set once per incident so that WAIT_EQUIVALENCE_MINUTES on the list is worth as much as the
          90th-percentile need-and-urgency term in the queue when door checks start.

Guardrails: the score only orders visits; nobody is skipped because of it. It is never shown per household.
"""

import math
from dataclasses import dataclass, field

import numpy as np

DEADLINE_MARGIN_MINUTES = 10.0  # matches DEADLINE_MARGIN_MINUTES in convex/model.ts
MIN_SLACK_MINUTES = 5.0
MIN_TRAVEL_MINUTES = 1.0
WAIT_EQUIVALENCE_MINUTES = 30.0
ALPHA_QUANTILE = 0.9
# alpha is fixed only once the queue has this many homes, so one early entry can't set it. Before
# that it is recomputed each pass.
MIN_QUEUE_FOR_ALPHA = 10

# Staging points for six field teams on main west Altadena streets. An assumption; pass your own.
DEFAULT_TEAMS: list[tuple[float, float]] = [
    (34.1897, -118.1588),  # Lincoln Ave at Altadena Dr area
    (34.1985, -118.1588),  # Lincoln Ave at Loma Alta Dr
    (34.1866, -118.1500),  # Fair Oaks Ave at Mariposa St
    (34.1806, -118.1500),  # Fair Oaks Ave at Woodbury Rd
    (34.1940, -118.1410),  # Marengo Ave north
    (34.1868, -118.1318),  # Lake Ave at Mariposa St
]


@dataclass
class DoorConfig:
    teams: list[tuple[float, float]] = field(default_factory=lambda: list(DEFAULT_TEAMS))
    wait_equivalence_minutes: float = WAIT_EQUIVALENCE_MINUTES
    alpha_quantile: float = ALPHA_QUANTILE


def urgency(minutes_to_arrival: float) -> float:
    slack = minutes_to_arrival - DEADLINE_MARGIN_MINUTES
    return 60.0 / max(slack, MIN_SLACK_MINUTES)


def need_urgency_term(p: float, minutes_to_arrival: float, travel_minutes: float) -> float:
    if math.isinf(travel_minutes):
        # No open road reaches it. Still on the list; urgency alone orders it, as if one minute away.
        travel_minutes = MIN_TRAVEL_MINUTES
    return p * urgency(minutes_to_arrival) / max(travel_minutes, MIN_TRAVEL_MINUTES)


def alpha_for(terms: list[float], config: DoorConfig) -> float:
    if not terms:
        return 0.0
    return float(np.quantile(terms, config.alpha_quantile)) / config.wait_equivalence_minutes


def priority(term: float, wait_minutes: float, alpha: float) -> float:
    return term + alpha * max(wait_minutes, 0.0)
