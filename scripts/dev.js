import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDirectory = resolve(projectRoot, "backend");
const frontendDirectory = resolve(projectRoot, "frontend");
const frontendRequire = createRequire(resolve(frontendDirectory, "package.json"));
const viteModule = frontendRequire.resolve("vite");
const viteCli = resolve(dirname(viteModule), "../../bin/vite.js");
const children = [];
let shuttingDown = false;

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  if (exitCode !== null) process.exitCode = exitCode;
}

function startProcess(name, executable, args, cwd) {
  const child = spawn(executable, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false
  });
  children.push(child);
  child.on("error", error => {
    console.error(`Unable to start ${name}: ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`${name} exited${signal ? ` after ${signal}` : ` with code ${code}`}. Stopping the other development server.`);
      shutdown(code ?? 1);
    }
  });
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

startProcess("Skill Swap backend", process.execPath, ["--watch-path=src", "src/server.js"], backendDirectory);
startProcess("Skill Swap frontend", process.execPath, [viteCli, "--host", "0.0.0.0"], frontendDirectory);
