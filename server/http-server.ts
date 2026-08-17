import type { Server } from "node:http";
import path from "node:path";
import express from "express";
import { createApiRouter } from "./api";
import { createHealthRouter } from "./health";
import { shutdownConsoleEngine } from "./runtime";

export interface ConsoleServerOptions {
  projectRoot: string;
  development?: boolean;
  host?: string;
  port?: number;
}

export interface RunningConsoleServer {
  host: string;
  port: number;
  localUrl: string;
  close: () => Promise<void>;
}

function listen(app: express.Express, port: number, host: string) {
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, host);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

export async function startConsoleServer(options: ConsoleServerOptions): Promise<RunningConsoleServer> {
  const development = options.development ?? false;
  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 3000;
  const app = express();
  let closeDevelopmentServer: (() => Promise<void>) | undefined;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));
  app.use(createHealthRouter());
  app.use("/api", createApiRouter());

  if (development) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: options.projectRoot,
      server: { middlewareMode: true, host },
      appType: "spa",
    });
    closeDevelopmentServer = () => vite.close();
    app.use(vite.middlewares);
  } else {
    const clientDirectory = path.join(options.projectRoot, "dist");
    app.use(express.static(clientDirectory, { index: false }));
    app.use((request, response, next) => {
      if (request.method !== "GET") return next();
      response.sendFile(path.join(clientDirectory, "index.html"));
    });
  }

  const server = await listen(app, port, host);
  let closed = false;

  return {
    host,
    port,
    localUrl: `http://127.0.0.1:${port}/`,
    close: async () => {
      if (closed) return;
      closed = true;
      await shutdownConsoleEngine();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await closeDevelopmentServer?.();
    },
  };
}
