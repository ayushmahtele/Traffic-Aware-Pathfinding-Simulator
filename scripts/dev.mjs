import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const backendUrl = "http://localhost:3001/api/health";
const frontendUrl = "http://localhost:5173";

function isHttpAvailable(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function spawnProcess(command, args, label) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: "inherit"
  });

  child.on("error", (error) => {
    console.error(`${label} failed to start: ${error.message}`);
  });

  return child;
}

const children = [];

const backendAlreadyRunning = await isHttpAvailable(backendUrl);
if (backendAlreadyRunning) {
  console.log("Using existing backend at http://localhost:3001");
} else {
  children.push(spawnProcess("node", ["backend/server.mjs"], "Backend"));
}

const frontendAlreadyRunning = await isHttpAvailable(frontendUrl);
if (frontendAlreadyRunning) {
  console.log("Using existing frontend at http://localhost:5173");
} else {
  children.push(spawnProcess("npx", ["parcel", "index.html", "--port", "5173"], "Frontend"));
}

if (children.length === 0) {
  console.log("Dev servers are already running. Press Ctrl+C to exit this watcher.");
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (signal === "SIGTERM" || signal === "SIGINT") {
      shutdown(0);
      return;
    }
    shutdown(code ?? 0);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.stdin.resume();
