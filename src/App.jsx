import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildEdgeMap,
  buildGraph,
  buildNodeMap,
  getEdgeLookup,
  getPathEdgeIds,
  randomNodeId
} from "./lib/map";

const INITIAL_GRAPH = buildGraph();
const INITIAL_CAR_COUNT = 6;
const CAR_TICK_MS = 50;
const TRAFFIC_TICK_MS = 1100;
const AUTO_REFRESH_MS = 5500;
const TRAFFIC_COST_FACTOR = 3.2;
const LOCAL_FRONTEND_PORTS = new Set(["1234", "4173", "5173"]);
const API_BASE = LOCAL_FRONTEND_PORTS.has(window.location.port) ? "http://localhost:3001" : "";
const ALGORITHMS = [
  { value: "dijkstra", label: "Dijkstra" },
  { value: "astar", label: "A*" },
  { value: "bfs", label: "BFS" },
  { value: "dfs", label: "DFS" }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nodeLabel(node) {
  return `${String.fromCharCode(65 + node.row)}${node.col + 1}`;
}

function edgeKey(a, b) {
  return [a, b].sort().join(":");
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  }
  return hash;
}

function baseTrafficForEdge(edgeId) {
  return 0.1 + (hashText(edgeId) % 19) / 100;
}

function buildInitialTrafficEdges(edges) {
  return edges.map((edge) => ({
    ...edge,
    traffic: edge.blocked ? 1 : baseTrafficForEdge(edge.id)
  }));
}

function formatAlgorithm(name) {
  const item = ALGORITHMS.find((algo) => algo.value === name);
  return item ? item.label : name;
}

function interpolatePoint(a, b, progress) {
  return {
    x: a.x + (b.x - a.x) * progress,
    y: a.y + (b.y - a.y) * progress
  };
}

function computeCarPose(car, nodeMap) {
  if (car.route.length < 2 || car.routeIndex >= car.route.length - 1) {
    const node = nodeMap[car.currentNode] || Object.values(nodeMap)[0];
    return {
      x: node.x,
      y: node.y,
      angle: 0
    };
  }

  const from = nodeMap[car.route[car.routeIndex]];
  const to = nodeMap[car.route[car.routeIndex + 1]];
  if (!from || !to) {
    const fallback = nodeMap[car.currentNode] || Object.values(nodeMap)[0];
    return {
      x: fallback.x,
      y: fallback.y,
      angle: 0
    };
  }

  const point = interpolatePoint(from, to, car.progress);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;

  return {
    x: point.x + normalX * car.laneOffset,
    y: point.y + normalY * car.laneOffset,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI
  };
}

function countCarsOnEdges(cars, edgeLookup) {
  const counts = {};
  for (const car of cars) {
    if (car.route.length < 2 || car.routeIndex >= car.route.length - 1) {
      continue;
    }
    const from = car.route[car.routeIndex];
    const to = car.route[car.routeIndex + 1];
    const edgeId = edgeLookup.get(edgeKey(from, to));
    if (edgeId) {
      counts[edgeId] = (counts[edgeId] || 0) + 1;
    }
  }
  return counts;
}

function updateTrafficEdges(previousEdges, cars, edgeLookup) {
  const counts = countCarsOnEdges(cars, edgeLookup);
  return previousEdges.map((edge) => {
    if (edge.blocked) {
      return {
        ...edge,
        traffic: 1
      };
    }

    const baseline = baseTrafficForEdge(edge.id);
    const pressure = clamp((counts[edge.id] || 0) * 0.15, 0, 0.5);
    const target = clamp(baseline + pressure, 0.08, 0.9);
    const smoothed = edge.traffic * 0.7 + target * 0.3;

    return {
      ...edge,
      traffic: Number(smoothed.toFixed(3))
    };
  });
}

function totalCostForEdge(edge) {
  return edge.baseCost * (1 + edge.traffic * TRAFFIC_COST_FACTOR);
}

function chooseReachableDestination(start, nodes, edges) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const nextDestination = randomNodeId(nodes, start);
    const route = greedyCarRoute(start, nextDestination, edges);
    if (route.length > 1) {
      return { nextDestination, route };
    }
  }

  return { nextDestination: start, route: [start] };
}

function createCar(index, nodes, edges) {
  const currentNode = randomNodeId(nodes);
  const { nextDestination, route } = chooseReachableDestination(currentNode, nodes, edges);
  return {
    id: `car-${index}`,
    route,
    routeIndex: 0,
    progress: Math.random() * 0.65,
    speed: 0.0002 + Math.random() * 0.00008,
    currentNode,
    targetNode: nextDestination,
    color: `hsl(${18 + index * 34}, 78%, 57%)`,
    laneOffset: index % 2 === 0 ? -7 : 7
  };
}

function advanceCar(car, deltaMs, nodes, edges, edgeLookup, edgeMap) {
  let nextCar = { ...car };

  if (nextCar.route.length < 2 || nextCar.routeIndex >= nextCar.route.length - 1) {
    const { nextDestination, route } = chooseReachableDestination(nextCar.currentNode, nodes, edges);
    nextCar = {
      ...nextCar,
      targetNode: nextDestination,
      route,
      routeIndex: 0,
      progress: 0
    };
  }

  let remainingProgress = nextCar.progress;
  let remainingTime = deltaMs;

  while (remainingTime > 0 && nextCar.routeIndex < nextCar.route.length - 1) {
    const from = nextCar.route[nextCar.routeIndex];
    const to = nextCar.route[nextCar.routeIndex + 1];
    const edgeId = edgeLookup.get(edgeKey(from, to));
    const edge = edgeMap[edgeId];
    const density = edge ? edge.traffic : 0.2;
    const progressPerMs = nextCar.speed * (1 - density * 0.58);
    const safeProgressPerMs = Math.max(progressPerMs, 0.00006);
    const timeToFinish = (1 - remainingProgress) / safeProgressPerMs;

    if (remainingTime >= timeToFinish) {
      remainingTime -= timeToFinish;
      nextCar.routeIndex += 1;
      nextCar.currentNode = nextCar.route[nextCar.routeIndex];
      remainingProgress = 0;
    } else {
      remainingProgress += remainingTime * safeProgressPerMs;
      remainingTime = 0;
    }
  }

  if (nextCar.routeIndex >= nextCar.route.length - 1) {
    nextCar.progress = 1;
    return nextCar;
  }

  nextCar.progress = clamp(remainingProgress, 0, 1);
  return nextCar;
}

async function requestPath(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE}/api/pathfind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Pathfinding failed");
    return result;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timed out. Is the backend running?");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h1>Something went wrong</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [nodes] = useState(INITIAL_GRAPH.nodes);
  const [startNode, setStartNode] = useState("n0-0");
  const [endNode, setEndNode] = useState("n5-7");
  const [algorithm, setAlgorithm] = useState("dijkstra");
  const [selectionMode, setSelectionMode] = useState("end");
  const [trafficEdges, setTrafficEdges] = useState(() => buildInitialTrafficEdges(INITIAL_GRAPH.edges));
  const [cars, setCars] = useState(() => buildInitialCars(INITIAL_GRAPH.nodes, buildInitialTrafficEdges(INITIAL_GRAPH.edges)));
  const [selectedPath, setSelectedPath] = useState([]);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("Pick start and end points, then compare the algorithms.");
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [animationPhase, setAnimationPhase] = useState("idle");
  const [animatedVisitCount, setAnimatedVisitCount] = useState(0);
  const [animatedPathCount, setAnimatedPathCount] = useState(0);
  const [animationFrameData, setAnimationFrameData] = useState(null);
  const nodeMapRef = useRef(buildNodeMap(INITIAL_GRAPH.nodes));
  const edgeLookupRef = useRef(getEdgeLookup(INITIAL_GRAPH.edges));
  const edgeMapRef = useRef(buildEdgeMap(buildInitialTrafficEdges(INITIAL_GRAPH.edges)));
  const trafficEdgesRef = useRef(trafficEdges);
  const carsRef = useRef(cars);
  const requestTokenRef = useRef(0);
  const algorithmRef = useRef(algorithm);
  const startNodeRef = useRef(startNode);
  const endNodeRef = useRef(endNode);
  const loadingRef = useRef(false);
  const animationPhaseRef = useRef("idle");
  const animationTimersRef = useRef([]);

  useEffect(() => {
    trafficEdgesRef.current = trafficEdges;
    edgeMapRef.current = buildEdgeMap(trafficEdges);
  }, [trafficEdges]);

  useEffect(() => {
    carsRef.current = cars;
  }, [cars]);

  useEffect(() => {
    algorithmRef.current = algorithm;
    startNodeRef.current = startNode;
    endNodeRef.current = endNode;
  }, [algorithm, startNode, endNode]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    animationPhaseRef.current = animationPhase;
  }, [animationPhase]);

  function clearAnimationTimers() {
    animationTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    animationTimersRef.current = [];
  }

  useEffect(() => () => clearAnimationTimers(), []);

  useEffect(() => {
    let previousTime = performance.now();

    const carTimer = setInterval(() => {
      const timestamp = performance.now();
      const deltaMs = Math.min(timestamp - previousTime, 160);
      previousTime = timestamp;

      setCars((currentCars) =>
        currentCars.map((car) =>
          advanceCar(
            car,
            deltaMs,
            nodes,
            trafficEdgesRef.current,
            edgeLookupRef.current,
            edgeMapRef.current
          )
        )
      );

    }, CAR_TICK_MS);

    return () => clearInterval(carTimer);
  }, [nodes]);

  useEffect(() => {
    const trafficTimer = setInterval(() => {
      setTrafficEdges((currentEdges) =>
        updateTrafficEdges(currentEdges, carsRef.current, edgeLookupRef.current)
      );
    }, TRAFFIC_TICK_MS);

    return () => clearInterval(trafficTimer);
  }, []);

  async function runPathfinding() {
    clearAnimationTimers();
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;
    setLoading(true);
    setAnimationPhase("waiting");
    setAnimatedVisitCount(0);
    setAnimatedPathCount(0);
    setAnimationFrameData(null);
    setSelectedPath([]);
    setStats(null);
    setStatus("Computing route with the current traffic load...");

    try {
      const result = await requestPath({
        algorithm: algorithmRef.current,
        start: startNodeRef.current,
        goal: endNodeRef.current,
        nodes,
        edges: trafficEdgesRef.current
      });

      if (requestTokenRef.current !== token) {
        return;
      }

      setSelectedPath(result.path);
      setStats(result);
      setAnimationFrameData({
        token,
        visitOrder: result.visitOrder || [],
        path: result.path || [],
        found: result.found,
        message: result.message
      });
      setStatus(result.found ? "Animating graph exploration..." : result.message);
    } catch (error) {
      if (requestTokenRef.current === token) {
        setSelectedPath([]);
        setStats(null);
        setAnimationPhase("done");
        setStatus(
          error instanceof TypeError
            ? "Backend is not reachable. Start the app with npm run dev so the API server runs with the frontend."
            : error.message
        );
      }
    } finally {
      if (requestTokenRef.current === token) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    runPathfinding();
  }, [algorithm, startNode, endNode]);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    const refreshTimer = setInterval(() => {
      if (loadingRef.current) {
        return;
      }
      if (animationPhaseRef.current === "searching" || animationPhaseRef.current === "path") {
        return;
      }
      runPathfinding();
    }, AUTO_REFRESH_MS);

    return () => clearInterval(refreshTimer);
  }, [autoRefresh]);

  useEffect(() => {
    if (!animationFrameData) {
      return undefined;
    }

    clearAnimationTimers();
    setAnimatedVisitCount(0);
    setAnimatedPathCount(0);

    const visitOrder = animationFrameData.visitOrder;
    const path = animationFrameData.path;
    const visitStepMs = clamp(Math.round(1500 / Math.max(visitOrder.length, 1)), 60, 150);
    const pathStepMs = clamp(Math.round(1100 / Math.max(path.length, 1)), 120, 230);
    const searchDuration = visitOrder.length * visitStepMs;

    if (visitOrder.length > 0) {
      setAnimationPhase("searching");
      visitOrder.forEach((_, index) => {
        const timerId = setTimeout(() => {
          setAnimatedVisitCount(index + 1);
        }, index * visitStepMs);
        animationTimersRef.current.push(timerId);
      });
    }

    const pathPhaseTimer = setTimeout(() => {
      if (!animationFrameData.found || path.length === 0) {
        setAnimationPhase("done");
        setStatus(animationFrameData.message);
        return;
      }

      setAnimationPhase("path");
      setStatus("Search complete. Drawing final route...");
      path.forEach((_, index) => {
        const timerId = setTimeout(() => {
          setAnimatedPathCount(index + 1);
        }, index * pathStepMs);
        animationTimersRef.current.push(timerId);
      });

      const doneTimer = setTimeout(() => {
        setAnimationPhase("done");
        setStatus("Route ready. Final path is highlighted against live traffic.");
      }, path.length * pathStepMs + 80);
      animationTimersRef.current.push(doneTimer);
    }, searchDuration + 160);

    animationTimersRef.current.push(pathPhaseTimer);
    return () => clearAnimationTimers();
  }, [animationFrameData]);

  const visiblePath = useMemo(
    () =>
      animationPhase === "done"
        ? selectedPath
        : selectedPath.slice(0, Math.max(animatedPathCount, 0)),
    [animatedPathCount, animationPhase, selectedPath]
  );
  const highlightedEdges = useMemo(
    () => new Set(getPathEdgeIds(visiblePath, edgeLookupRef.current)),
    [visiblePath]
  );
  const pathNodes = useMemo(() => new Set(visiblePath), [visiblePath]);
  const exploredVisitOrder = useMemo(
    () => (animationPhase === "done" ? [] : stats?.visitOrder?.slice(0, animatedVisitCount) || []),
    [animatedVisitCount, animationPhase, stats]
  );
  const exploredNodes = useMemo(() => new Set(exploredVisitOrder), [exploredVisitOrder]);
  const activeSearchNodeId = exploredVisitOrder[exploredVisitOrder.length - 1] || null;
  const exploredLookup = useMemo(
    () => new Map(exploredVisitOrder.map((nodeId, index) => [nodeId, index + 1])),
    [exploredVisitOrder]
  );
  const nodeOptions = useMemo(
    () =>
      nodes.map((node) => ({
        value: node.id,
        label: nodeLabel(node)
      })),
    [nodes]
  );
  const selectedNodeLabels = {
    start: nodeLabel(nodeMapRef.current[startNode] || nodes[0]),
    end: nodeLabel(nodeMapRef.current[endNode] || nodes[0])
  };
  const roadElements = useMemo(() => {
    const routeIsVisible = visiblePath.length > 1;

    return trafficEdges.map((edge) => {
      const from = nodeMapRef.current[edge.from];
      const to = nodeMapRef.current[edge.to];
      if (!from || !to) {
        return null;
      }
      const isHighlighted = highlightedEdges.has(edge.id);
      const trafficClass = edge.blocked
        ? "closed"
        : edge.traffic > 0.6
          ? "high"
          : edge.traffic > 0.3
            ? "medium"
            : "low";
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;

      return (
        <g
          key={edge.id}
          className={`road-group ${routeIsVisible && !isHighlighted ? "route-muted" : ""}`}
        >
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="road-bed" />
          <line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            className={`road-traffic ${trafficClass}`}
          />
          {!edge.blocked ? (
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="road-center-line" />
          ) : null}
          {isHighlighted ? (
            <>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="route-halo" />
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="route-line" />
            </>
          ) : null}
          {!edge.blocked ? (
            <g className="road-cost-pill">
              <rect x={midX - 14} y={midY - 11} width="28" height="18" rx="9" />
              <text x={midX} y={midY + 2} className="road-weight">
                {totalCostForEdge(edge).toFixed(1)}
              </text>
            </g>
          ) : null}
        </g>
      );
    });
  }, [highlightedEdges, trafficEdges, visiblePath.length]);

  function handleNodeClick(nodeId) {
    if (selectionMode === "start") {
      if (nodeId === endNode) {
        setStatus("Start and end cannot be the same node.");
        return;
      }
      setStartNode(nodeId);
      setStatus(`Start point moved to ${nodeLabel(nodeMapRef.current[nodeId])}.`);
      return;
    }

    if (nodeId === startNode) {
      setStatus("Start and end cannot be the same node.");
      return;
    }
    setEndNode(nodeId);
    setStatus(`End point moved to ${nodeLabel(nodeMapRef.current[nodeId])}.`);
  }

  return (
   <ErrorBoundary>
    <div className={`app-shell phase-${animationPhase}`}>
      <aside className="control-panel">
        <div className="panel-card intro-card">
          <p className="eyebrow">DAA Lab Project</p>
          <h1>
            <span>Traffic-Aware</span>
            <span>Pathfinding Simulator</span>
          </h1>
          <p className="lede">
            Compare Dijkstra, A*, BFS &amp; DFS in real time on a live road
            network where animated cars create dynamic congestion.
          </p>
        </div>

        <div className="panel-card">
          <h2>Controls</h2>
          <label className="field">
            <span>Algorithm</span>
            <select value={algorithm} onChange={(event) => setAlgorithm(event.target.value)}>
              {ALGORITHMS.map((algo) => (
                <option key={algo.value} value={algo.value}>
                  {algo.label}
                </option>
              ))}
            </select>
          </label>

          <div className="selection-grid">
            <label className="field">
              <span>Start</span>
              <select
                value={startNode}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue !== endNode) {
                    setStartNode(nextValue);
                  } else {
                    setStatus("Start and end cannot be the same node.");
                  }
                }}
              >
                {nodeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>End</span>
              <select
                value={endNode}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue !== startNode) {
                    setEndNode(nextValue);
                  } else {
                    setStatus("Start and end cannot be the same node.");
                  }
                }}
              >
                {nodeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="toggle-group">
            <button
              type="button"
              className={selectionMode === "start" ? "active" : ""}
              onClick={() => setSelectionMode("start")}
            >
              Click Map For Start
            </button>
            <button
              type="button"
              className={selectionMode === "end" ? "active" : ""}
              onClick={() => setSelectionMode("end")}
            >
              Click Map For End
            </button>
          </div>

          <div className="summary-chip-row">
            <span className="summary-chip">Start: {selectedNodeLabels.start}</span>
            <span className="summary-chip">End: {selectedNodeLabels.end}</span>
            <span className="summary-chip">Cars: {cars.length}</span>
            <span className="summary-chip">
              Search: {animatedVisitCount}/{stats?.visitOrder?.length || 0}
            </span>
          </div>

          <button type="button" className="primary-button" onClick={runPathfinding} disabled={loading}>
            {loading ? "Solving..." : "Simulate Route"}
          </button>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            <span>Auto-refresh route every 5.5 seconds</span>
          </label>
        </div>

        <div className="panel-card stats-card">
          <h2>Result</h2>
          <p className="status-text">{status}</p>
          {stats ? (
            <div className="stats-grid">
              <div>
                <span>Algorithm</span>
                <strong>{formatAlgorithm(stats.algorithm)}</strong>
              </div>
              <div>
                <span>Cost</span>
                <strong>{stats.totalCost.toFixed(2)}</strong>
              </div>
              <div>
                <span>Roads</span>
                <strong>{Math.max(stats.path.length - 1, 0)}</strong>
              </div>
              <div>
                <span>Visited</span>
                <strong>{stats.visitedCount}</strong>
              </div>
            </div>
          ) : null}
          {stats?.path?.length ? (
            <p className="path-text">
              Path: {stats.path.map((id) => nodeLabel(nodeMapRef.current[id])).join(" -> ")}
            </p>
          ) : null}
        </div>

        <div className="panel-card legend-card">
          <h2>Legend</h2>
          <ul>
            <li><span className="legend-swatch route"></span> Selected route</li>
            <li><span className="legend-swatch search"></span> Search exploration</li>
            <li><span className="legend-swatch low"></span> Light traffic</li>
            <li><span className="legend-swatch medium"></span> Medium traffic</li>
            <li><span className="legend-swatch high"></span> Heavy traffic</li>
            <li><span className="legend-swatch car"></span> Moving traffic car</li>
            <li><span className="legend-swatch closed"></span> Closed road</li>
          </ul>
          <p className="footnote">
            Dijkstra and A* minimize traffic-weighted cost. BFS and DFS still use
            their own traversal behavior, so they can choose a valid path that is
            not the cheapest during congestion.
          </p>
        </div>
      </aside>

      <main className="map-panel">
        <div className="map-header">
          <div>
            <p className="eyebrow">Live Simulation</p>
            <h2>Road Network View</h2>
          </div>
          <p className="map-tip">
            Use the dropdowns or click the map while <strong>{selectionMode}</strong> mode is active.
          </p>
        </div>

        <div className="map-scroll" aria-label="Scrollable road network area">
          {loading && <div className="loading-overlay"><div className="spinner" /></div>}
          <svg
            className="city-map"
            viewBox={`0 0 ${INITIAL_GRAPH.width} ${INITIAL_GRAPH.height}`}
            role="img"
            aria-label="Traffic pathfinding map"
          >
            <defs>
            <linearGradient id="routeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#fee08b" />
              <stop offset="100%" stopColor="#f46d43" />
            </linearGradient>
            <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="rgba(17, 27, 33, 0.28)" />
            </filter>
            </defs>

          <rect
            x="24"
            y="24"
            width={INITIAL_GRAPH.width - 48}
            height={INITIAL_GRAPH.height - 48}
            rx="28"
            className="map-frame"
          />

          {roadElements}

          {cars.map((car) => {
            const pose = computeCarPose(car, nodeMapRef.current);
            return (
              <g
                key={car.id}
                className="car-layer"
                transform={`translate(${pose.x} ${pose.y}) rotate(${pose.angle})`}
                filter="url(#softShadow)"
              >
                <rect x="-12" y="-5.2" width="24" height="10.4" rx="4.6" className="car-shell" fill={car.color} />
                <rect x="-5.2" y="-3.4" width="9" height="6.8" rx="2.5" className="car-roof" />
                <circle cx="-6.8" cy="5.8" r="1.3" className="wheel" />
                <circle cx="6.8" cy="5.8" r="1.3" className="wheel" />
                <circle cx="-6.8" cy="-5.8" r="1.3" className="wheel" />
                <circle cx="6.8" cy="-5.8" r="1.3" className="wheel" />
              </g>
            );
          })}

          {nodes.map((node) => {
            const isStart = node.id === startNode;
            const isEnd = node.id === endNode;
            const isExplored = exploredNodes.has(node.id);
            const isPathNode = pathNodes.has(node.id);
            const isActiveSearchNode = node.id === activeSearchNodeId;
            const visitStep = exploredLookup.get(node.id);
            return (
              <g key={node.id} className="node-group">
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="20"
                  className="node-hitbox"
                  onClick={() => handleNodeClick(node.id)}
                />
                {isExplored ? (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={isActiveSearchNode ? "23" : "18"}
                    className={`search-node ${isActiveSearchNode ? "active" : ""}`}
                  />
                ) : null}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isStart || isEnd ? 13 : 9}
                  className={`node-dot ${isStart ? "start" : ""} ${isEnd ? "end" : ""} ${isPathNode ? "path" : ""}`}
                />
                {visitStep && isActiveSearchNode ? (
                  <text x={node.x} y={node.y - 18} className="visit-order-label">
                    {visitStep > 99 ? "99+" : visitStep}
                  </text>
                ) : null}
                <text x={node.x} y={node.y + 31} className="node-label">
                  {nodeLabel(node)}
                </text>
              </g>
            );
          })}
          </svg>
        </div>
      </main>
      <footer className="app-footer">Traffic-Aware Pathfinding Simulator &mdash; DAA Lab Project</footer>
    </div>
   </ErrorBoundary>
  );
}

function buildInitialCars(nodes, edges) {
  return Array.from({ length: INITIAL_CAR_COUNT }, (_, index) => createCar(index, nodes, edges));
}

function greedyCarRoute(start, goal, edges) {
  const adjacency = new Map();

  for (const edge of edges) {
    if (edge.blocked) {
      continue;
    }

    const cost = totalCostForEdge(edge);
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, []);
    }
    if (!adjacency.has(edge.to)) {
      adjacency.set(edge.to, []);
    }

    adjacency.get(edge.from).push({ id: edge.to, cost });
    adjacency.get(edge.to).push({ id: edge.from, cost });
  }

  const queue = [{ id: start, cost: 0 }];
  const distance = new Map([[start, 0]]);
  const previous = new Map();
  const visited = new Set();

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (!current || visited.has(current.id)) {
      continue;
    }

    visited.add(current.id);
    if (current.id === goal) {
      break;
    }

    const neighbors = adjacency.get(current.id) || [];
    for (const neighbor of neighbors) {
      const nextCost = current.cost + neighbor.cost;
      if (!distance.has(neighbor.id) || nextCost < distance.get(neighbor.id)) {
        distance.set(neighbor.id, nextCost);
        previous.set(neighbor.id, current.id);
        queue.push({ id: neighbor.id, cost: nextCost });
      }
    }
  }

  if (!distance.has(goal)) {
    return [start];
  }

  const path = [];
  let current = goal;
  while (current) {
    path.unshift(current);
    current = previous.get(current);
  }
  return path;
}
