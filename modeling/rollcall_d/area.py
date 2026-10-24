"""The study area: west Altadena, west of Lake Ave. Matches AREA in convex/model.ts with a margin
so the road graph and address points cover everything the call floor can show."""

SOUTH, NORTH, WEST, EAST = 34.168, 34.212, -118.178, -118.128

# (west, south, east, north), the order OSMnx and most GIS tools expect.
BBOX = (WEST, SOUTH, EAST, NORTH)
