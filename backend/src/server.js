import "./config/env.js";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { app } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { isAllowedClientOrigin } from "./config/clientOrigins.js";
import { getClientOrigin } from "./config/clientOrigins.js";
import { attachRealtime } from "./realtime.js";

const port = Number(process.env.PORT || 5000);
const server = createServer(app);

export const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, !origin || isAllowedClientOrigin(
      origin,
      getClientOrigin()
    )),
    credentials: true
  }
});
app.set("io", io);
attachRealtime(io);

export async function start() {
  const { validateEnvironment } = await import("./config/env.js");
  validateEnvironment();
  await connectDatabase();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      console.info(`Skill Swap API listening on http://localhost:${port}`);
      resolve();
    });
  });
}

export async function stop() {
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
  const { disconnectDatabase } = await import("./config/database.js");
  await disconnectDatabase();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  start().then(() => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => {
        stop().then(() => process.exit(0)).catch(error => {
          console.error(`Unable to shut down cleanly: ${error.message}`);
          process.exit(1);
        });
      });
    }
  }).catch(error => {
    console.error(`Unable to start Skill Swap API: ${error.message}`);
    process.exitCode = 1;
  });
}
