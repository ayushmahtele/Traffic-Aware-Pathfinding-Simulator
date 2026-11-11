import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const binaryDir = path.join(rootDir, "backend", "bin");

mkdirSync(binaryDir, { recursive: true });

const result = spawnSync(
  "g++",
  [
    "-std=c++17",
    "-O2",
    path.join(rootDir, "backend", "cpp", "pathfinder.cpp"),
    "-o",
    path.join(binaryDir, "pathfinder")
  ],
  {
    cwd: rootDir,
    stdio: "inherit"
  }
);

process.exit(result.status ?? 1);
