import { networkInterfaces } from "node:os";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { PatchedFixture } from "../lib/console-types";
import { getConsoleEngine } from "./runtime";

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function requestedDuration(request: Request) {
  if (request.query.transitionMs !== undefined) return Number(request.query.transitionMs);
  if (request.query.seconds !== undefined) return Number(request.query.seconds) * 1000;
  if (request.body?.transitionMs !== undefined) return Number(request.body.transitionMs);
  return undefined;
}

export function createApiRouter() {
  const router = Router();

  router.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.sendStatus(204);
      return;
    }
    next();
  });

  router.get("/console/state", asyncRoute(async (_request, response) => {
    const engine = await getConsoleEngine();
    response.json({ ok: true, ...engine.snapshot() });
  }));

  router.get("/console/health", asyncRoute(async (_request, response) => {
    const engine = await getConsoleEngine();
    response.json({ ok: true, dmx: engine.getDmxStatus() });
  }));

  router.get("/console/export", asyncRoute(async (_request, response) => {
    const engine = await getConsoleEngine();
    const date = new Date().toISOString().slice(0, 10);
    response.setHeader("Content-Disposition", `attachment; filename="open-dmx-console-${date}.json"`);
    response.json({
      format: "open-dmx-console",
      version: 1,
      exportedAt: new Date().toISOString(),
      state: engine.exportState(),
    });
  }));

  router.post("/console/import", asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = await engine.importState(request.body);
    response.json({ ok: true, ...snapshot });
  }));

  router.get("/console/network", (request, response) => {
    const port = request.socket.localPort || Number(process.env.PORT) || 3000;
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((address) => address?.family === "IPv4" && !address.internal)
      .map((address) => `http://${address!.address}:${port}`);
    response.json({ ok: true, addresses: [...new Set(addresses)] });
  });

  router.get("/console/presets", asyncRoute(async (_request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = engine.snapshot();
    response.json({
      ok: true,
      presets: snapshot.presets.map(({ id, name, createdAt }) => ({
        id,
        name,
        createdAt,
        recallUrl: `/api/console/presets/${id}/recall`,
      })),
    });
  }));

  router.post("/console/fixtures", asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = await engine.setPatch((request.body?.fixtures ?? []) as PatchedFixture[]);
    response.json({ ok: true, ...snapshot });
  }));

  router.post("/console/live", asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = engine.setLiveValues(request.body?.values ?? {});
    response.json({ ok: true, ...snapshot });
  }));

  router.post("/console/transition", asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = await engine.setTransitionTime(Number(request.body?.transitionMs));
    response.json({ ok: true, ...snapshot });
  }));

  router.post("/console/presets", asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const preset = await engine.capturePreset(String(request.body?.name ?? ""));
    response.json({ ok: true, preset });
  }));

  const recallConsolePreset = asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = engine.recallPreset(String(request.params.id), requestedDuration(request));
    response.json({ ok: true, ...snapshot });
  });
  router.get("/console/presets/:id/recall", recallConsolePreset);
  router.post("/console/presets/:id/recall", recallConsolePreset);

  router.post("/console/presets/:id/overwrite", asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = await engine.overwritePreset(String(request.params.id));
    response.json({ ok: true, ...snapshot });
  }));

  router.delete("/console/presets/:id", asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = await engine.deletePreset(String(request.params.id));
    response.json({ ok: true, ...snapshot });
  }));

  router.post("/console/dmx/reconnect", asyncRoute(async (_request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = await engine.reconnectDmx();
    response.json({ ok: true, ...snapshot });
  }));

  router.get("/companion/presets", asyncRoute(async (_request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = engine.snapshot();
    response.json({
      ok: true,
      console: "Open DMX Console",
      presets: snapshot.presets.map(({ id, name }) => ({
        id,
        name,
        recall: `/api/companion/recall/${id}`,
      })),
    });
  }));

  const recallCompanionPreset = asyncRoute(async (request, response) => {
    const engine = await getConsoleEngine();
    const snapshot = engine.recallPreset(String(request.params.id), requestedDuration(request));
    response.json({
      ok: true,
      preset: snapshot.transition.presetName,
      transitionMs: snapshot.transition.durationMs,
    });
  });
  router.get("/companion/recall/:id", recallCompanionPreset);
  router.post("/companion/recall/:id", recallCompanionPreset);

  router.use((_request, response) => {
    response.status(404).json({ ok: false, error: "Endpoint not found." });
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message) ? 404 : 400;
    response.status(status).json({ ok: false, error: message });
  });

  return router;
}
