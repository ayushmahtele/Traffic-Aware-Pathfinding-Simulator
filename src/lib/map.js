const GRID_ROWS = 6;
const GRID_COLS = 8;
const CELL_SIZE = 110;
const MAP_MARGIN = 70;

const CLOSED_ROADS = new Set([
  "n1-1:n1-2",
  "n2-3:n3-3",
  "n3-5:n4-5",
  "n4-1:n4-2",
  "n0-4:n1-4"
]);

function edgeKey(a, b) {
  return [a, b].sort().join(":");
}

export function buildGraph() {
  const nodes = [];
  const edges = [];

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      nodes.push({
        id: `n${row}-${col}`,
        row,
        col,
        x: MAP_MARGIN + col * CELL_SIZE,
        y: MAP_MARGIN + row * CELL_SIZE
      });
    }
  }

  const getNodeId = (row, col) => `n${row}-${col}`;

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const from = getNodeId(row, col);
      if (col + 1 < GRID_COLS) {
        const to = getNodeId(row, col + 1);
        edges.push({
          id: `e-h-${row}-${col}`,
          from,
          to,
          baseCost: 1,
          traffic: 0.2,
          blocked: CLOSED_ROADS.has(edgeKey(from, to))
        });
      }
      if (row + 1 < GRID_ROWS) {
        const to = getNodeId(row + 1, col);
        edges.push({
          id: `e-v-${row}-${col}`,
          from,
          to,
          baseCost: 1,
          traffic: 0.2,
          blocked: CLOSED_ROADS.has(edgeKey(from, to))
        });
      }
    }
  }

  return {
    nodes,
    edges,
    width: MAP_MARGIN * 2 + (GRID_COLS - 1) * CELL_SIZE,
    height: MAP_MARGIN * 2 + (GRID_ROWS - 1) * CELL_SIZE
  };
}

export function buildNodeMap(nodes) {
  return Object.fromEntries(nodes.map((node) => [node.id, node]));
}

export function buildEdgeMap(edges) {
  return Object.fromEntries(edges.map((edge) => [edge.id, edge]));
}

export function getEdgeLookup(edges) {
  const lookup = new Map();
  for (const edge of edges) {
    lookup.set(edgeKey(edge.from, edge.to), edge.id);
  }
  return lookup;
}

export function getPathEdgeIds(path, edgeLookup) {
  const ids = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const id = edgeLookup.get(edgeKey(path[i], path[i + 1]));
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

export function randomNodeId(nodes, excludeId) {
  const candidates = excludeId
    ? nodes.filter((node) => node.id !== excludeId)
    : nodes;
  const choice = candidates[Math.floor(Math.random() * candidates.length)];
  return choice.id;
}
