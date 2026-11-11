import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const cppSource = path.join(__dirname, "cpp", "pathfinder.cpp");
const binaryDir = path.join(__dirname, "bin");
const binaryPath = path.join(binaryDir, "pathfinder");
const PORT = process.env.PORT || 3001;

function ensureBinary() {
  mkdirSync(binaryDir, { recursive: true });
  const sourceMtime = statSync(cppSource).mtimeMs;
  const binaryMissing = !existsSync(binaryPath);
  const binaryStale = !binaryMissing && statSync(binaryPath).mtimeMs < sourceMtime;

  if (!binaryMissing && !binaryStale) {
    return;
  }

  const result = spawnSync(
    "g++",
    ["-std=c++17", "-O2", cppSource, "-o", binaryPath],
    {
      cwd: rootDir,
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    throw new Error(`C++ compile failed:\n${result.stderr || result.stdout}`);
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Payload too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function toSolverInput(payload) {
  const lines = [];
  lines.push(payload.algorithm);
  lines.push(payload.start);
  lines.push(payload.goal);
  lines.push(`${payload.nodes.length} ${payload.edges.length}`);
  for (const node of payload.nodes) {
    lines.push(`${node.id} ${node.x} ${node.y}`);
  }
  for (const edge of payload.edges) {
    lines.push(
      `${edge.id} ${edge.from} ${edge.to} ${edge.baseCost} ${edge.traffic} ${edge.blocked ? 1 : 0}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseSolverOutput(output) {
  const result = {
    found: false,
    algorithm: "unknown",
    totalCost: 0,
    visitedCount: 0,
    path: [],
    visitOrder: [],
    message: "No route found."
  };

  for (const line of output.trim().split("\n")) {
    const [key, ...rest] = line.split(" ");
    if (key === "FOUND") {
      result.found = rest[0] === "1";
    } else if (key === "ALGORITHM") {
      result.algorithm = rest[0];
    } else if (key === "TOTAL_COST") {
      result.totalCost = Number(rest[0]);
    } else if (key === "VISITED_COUNT") {
      result.visitedCount = Number(rest[0]);
    } else if (key === "MESSAGE") {
      result.message = rest.join(" ");
    } else if (key === "PATH") {
      const count = Number(rest[0]);
      result.path = rest.slice(1, count + 1);
    } else if (key === "VISIT_ORDER") {
      const count = Number(rest[0]);
      result.visitOrder = rest.slice(1, count + 1);
    }
  }

  return result;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Missing request body");
  }
  if (!["dijkstra", "astar", "bfs", "dfs"].includes(payload.algorithm)) {
    throw new Error("Unsupported algorithm");
  }
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
    throw new Error("Invalid graph");
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && request.url === "/api/pathfind") {
    try {
      ensureBinary();
      const rawBody = await readBody(request);
      const payload = JSON.parse(rawBody);
      validatePayload(payload);
      const result = spawnSync(binaryPath, [], {
        cwd: rootDir,
        input: toSolverInput(payload),
        encoding: "utf8"
      });

      if (result.status !== 0) {
        throw new Error(result.stderr || "Solver execution failed");
      }

      sendJson(response, 200, parseSolverOutput(result.stdout));
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
