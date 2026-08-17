import { Router, type Request, type Response } from "express";
import type { DmxStatus } from "@/lib/console-types";
import { getConsoleEngine } from "./runtime";

export const DMX_FRAME_STALE_AFTER_MS = 2_000;

interface HealthResponse {
  ok: boolean;
  status: "healthy" | "unhealthy";
  dmx: DmxStatus;
  reason?: string;
}

export function assessDmxHealth(
  dmx: DmxStatus,
  now = Date.now(),
): { statusCode: 200 | 503; body: HealthResponse } {
  if (dmx.state === "simulation") {
    return {
      statusCode: 200,
      body: { ok: true, status: "healthy", dmx },
    };
  }

  if (dmx.state !== "connected") {
    return {
      statusCode: 503,
      body: {
        ok: false,
        status: "unhealthy",
        reason: dmx.message,
        dmx,
      },
    };
  }

  const frameAgeMs = dmx.lastFrameAt === undefined ? Infinity : now - dmx.lastFrameAt;
  if (frameAgeMs > DMX_FRAME_STALE_AFTER_MS) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        status: "unhealthy",
        reason: "The DMX interface is connected but is not sending frames.",
        dmx,
      },
    };
  }

  return {
    statusCode: 200,
    body: { ok: true, status: "healthy", dmx },
  };
}

type ConsoleEngineProvider = () => Promise<{
  getDmxStatus(): DmxStatus;
}>;

export async function checkHealth(getEngine: ConsoleEngineProvider = getConsoleEngine) {
  try {
    const engine = await getEngine();
    return assessDmxHealth(engine.getDmxStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      statusCode: 500 as const,
      body: {
        ok: false,
        status: "error" as const,
        error: message,
      },
    };
  }
}

export function createHealthRouter(getEngine: ConsoleEngineProvider = getConsoleEngine) {
  const router = Router();

  router.get("/health", async (_request: Request, response: Response) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    const result = await checkHealth(getEngine);
    response.status(result.statusCode).json(result.body);
  });

  return router;
}
