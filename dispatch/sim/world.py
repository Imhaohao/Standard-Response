"""One simulated night's fixed facts: who lives where, what they need, the fleet, the roads."""

from __future__ import annotations

from dataclasses import dataclass

from .constants import SHELTER, SHIFT_LENGTH_S, Config
from .population import Household, VehicleSpec, fleet_of_size, make_population, vehicle_start_nodes
from .roads import RoadNetwork, TravelTimes, network


@dataclass
class World:
    seed: int
    config: Config
    net: RoadNetwork
    households: list[Household]
    fleet: list[VehicleSpec]
    vehicle_nodes: list[int]
    shelter_node: int
    travel: TravelTimes

    @property
    def needers(self) -> list[Household]:
        return [h for h in self.households if h.need is not None]

    @property
    def horizon_s(self) -> float:
        latest = max((h.fire_arrival_s for h in self.needers), default=0.0)
        return latest + 1800.0

    @property
    def shift_end_s(self) -> float:
        return SHIFT_LENGTH_S


def build_world(seed: int, config: Config) -> World:
    net = network()
    households = make_population(seed, net, config)
    fleet = fleet_of_size(config.fleet_size)
    vehicle_nodes = vehicle_start_nodes(seed, net, len(fleet))
    shelter_node = net.snap(SHELTER["lat"], SHELTER["lng"])
    sources = [h.node for h in households] + vehicle_nodes + [shelter_node]
    travel = TravelTimes(sources, config.hazard_scale)
    return World(seed, config, net, households, fleet, vehicle_nodes, shelter_node, travel)
