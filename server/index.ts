import path from "node:path";
import { fileURLToPath } from "node:url";
import { startConsoleServer } from "./http-server";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const development = process.argv.includes("--dev");
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const server = await startConsoleServer({ projectRoot, development, host, port });
console.log(`Open DMX Console listening at ${server.localUrl}`);
console.log(`LAN binding: http://${host}:${port}`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing DMX and HTTP services.`);
  const forceExit = setTimeout(() => process.exit(1), 4500);
  forceExit.unref();
  await server.close();
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
