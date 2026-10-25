// Water as polygons for the other cities. OSM draws a coast as lines with the land on their left,
// not as areas, and the lines run on far past any box we bake. So the box is cut into a grid, the
// coastline is drawn into it, and each stretch of grid the coastline encloses is called sea when more
// of the coast faces it from the water side than from the land side. Rivers and canals mapped as
// multipolygons are filled into the same grid, and the water cells come back as polygons (outline.mjs).
import { outlineCells } from "./outline.mjs";

const CELL_METERS = 10;

function rasterGrid(box) {
  const cols = Math.ceil((box.x1 - box.x0) / CELL_METERS);
  const rows = Math.ceil((box.y1 - box.y0) / CELL_METERS);
  const cellOf = ([x, y]) => {
    const c = Math.floor((x - box.x0) / CELL_METERS);
    const r = Math.floor((y - box.y0) / CELL_METERS);
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
  };
  return { cols, rows, cellOf };
}

// Every cell a coastline crosses, and a vote on each side of it: water to the right, land to the left.
function drawCoast(grid, coastlines) {
  const coast = new Uint8Array(grid.cols * grid.rows);
  const votes = [];
  for (const line of coastlines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      const length = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(length / (CELL_METERS / 3)));
      for (let s = 0; s <= steps; s++) {
        const cell = grid.cellOf([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
        if (cell >= 0) coast[cell] = 1;
      }
      if (length === 0) continue;
      const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
      const [nx, ny] = [((by - ay) / length) * CELL_METERS * 1.6, (-(bx - ax) / length) * CELL_METERS * 1.6];
      votes.push({ cell: grid.cellOf([mx + nx, my + ny]), water: 1 }, { cell: grid.cellOf([mx - nx, my - ny]), water: -1 });
    }
  }
  return { coast, votes };
}

function neighbours(grid, cell) {
  const c = cell % grid.cols;
  const size = grid.cols * grid.rows;
  return [c > 0 ? cell - 1 : -1, c < grid.cols - 1 ? cell + 1 : -1, cell - grid.cols, cell + grid.cols].filter((n) => n >= 0 && n < size);
}

function fill(grid, coast, region, start, label) {
  const stack = [start];
  region[start] = label;
  while (stack.length) {
    for (const next of neighbours(grid, stack.pop())) {
      if (coast[next] || region[next] >= 0) continue;
      region[next] = label;
      stack.push(next);
    }
  }
}

// Connected stretches of grid between coastlines (4-neighbour flood fill).
function regions(grid, coast) {
  const region = new Int32Array(grid.cols * grid.rows).fill(-1);
  let count = 0;
  for (let start = 0; start < region.length; start++) {
    if (coast[start] || region[start] >= 0) continue;
    fill(grid, coast, region, start, count);
    count++;
  }
  return { region, count };
}

function regionVotes(region, count, votes) {
  const tally = new Float64Array(count);
  for (const { cell, water } of votes) if (cell >= 0 && region[cell] >= 0) tally[region[cell]] += water;
  return tally;
}

function seaCells(grid, coastlines) {
  const { coast, votes } = drawCoast(grid, coastlines);
  const { region, count } = regions(grid, coast);
  const tally = regionVotes(region, count, votes);
  const sea = Uint8Array.from(region, (label) => (label >= 0 && tally[label] > 0 ? 1 : 0));
  // A coast cell joins the sea when most of its neighbours are sea, so the water reaches the shore.
  coast.forEach((onCoast, cell) => {
    if (!onCoast) return;
    const around = neighbours(grid, cell);
    sea[cell] = around.filter((n) => sea[n]).length * 2 > around.length ? 1 : 0;
  });
  return sea;
}

// The water cells as polygons in local metres: { ring, holes } per connected patch, the holes its islands.
function polygons(grid, mask, box) {
  const toLocal = ([gx, gy]) => [Math.min(box.x1, box.x0 + gx * CELL_METERS), Math.min(box.y1, box.y0 + gy * CELL_METERS)];
  return outlineCells(grid, mask).map(({ ring, holes }) => ({ ring: ring.map(toLocal), holes: holes.map((hole) => hole.map(toLocal)) }));
}

// Fills a multipolygon's cells, even-odd across every member line, so inner rings (islands) cut holes
// out of the outer ones. A valid multipolygon's members close into loops however they are split.
function fillMultipolygon(grid, box, lines, mask) {
  for (let r = 0; r < grid.rows; r++) {
    const y = box.y0 + (r + 0.5) * CELL_METERS;
    const crossings = [];
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const [[ax, ay], [bx, by]] = [line[i - 1], line[i]];
        if (ay > y !== by > y) crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((crossings[k] - box.x0) / CELL_METERS - 0.5));
      const c1 = Math.min(grid.cols - 1, Math.floor((crossings[k + 1] - box.x0) / CELL_METERS - 0.5));
      for (let c = c0; c <= c1; c++) mask[r * grid.cols + c] = 1;
    }
  }
}

// The sea closed from `coastlines`, plus every water multipolygon in `multipolygons` (each a list of
// its member lines, outer and inner), as polygons in local metres over `box`, the baked extent.
export function waterRings({ coastlines, multipolygons }, box) {
  if (coastlines.length === 0 && multipolygons.length === 0) return [];
  const grid = rasterGrid(box);
  const mask = coastlines.length ? seaCells(grid, coastlines) : new Uint8Array(grid.cols * grid.rows);
  for (const lines of multipolygons) fillMultipolygon(grid, box, lines, mask);
  return polygons(grid, mask, box);
}
