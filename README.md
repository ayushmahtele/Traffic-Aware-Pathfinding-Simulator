# Traffic-Aware Pathfinding Simulator

An interactive React + C++ project that visualizes pathfinding on a city-road graph with live congestion.

## Features

- Compare `Dijkstra`, `A*`, `BFS`, and `DFS`
- Click intersections to choose start and end nodes
- Watch animated cars create changing traffic on roads
- Recompute the user's route using current edge density
- Keep the search logic in C++

## Tech Stack

- React + Parcel for the UI
- Native Node.js HTTP server as the bridge API
- C++17 solver for the pathfinding algorithms

## Run

1. Install dependencies:

```bash
npm install
```

2. Start the backend and frontend together:

```bash
npm run dev
```

3. Open the app at `http://localhost:5173`

## Build

```bash
npm run build
```

## Notes

- `Dijkstra` and `A*` minimize traffic-weighted route cost.
- `BFS` and `DFS` still use their own traversal behavior, so their returned paths may be more expensive under congestion.
- Closed roads are removed from the graph entirely.
