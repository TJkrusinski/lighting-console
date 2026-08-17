import assert from "node:assert/strict";
import test from "node:test";
import type { DmxStatus } from "../lib/console-types";
import { assessDmxHealth, checkHealth, DMX_FRAME_STALE_AFTER_MS } from "../server/health";

const status = (overrides: Partial<DmxStatus> = {}): DmxStatus => ({
  state: "connected",
  message: "Streaming DMX.",
  framesSent: 42,
  lastFrameAt: 10_000,
  ...overrides,
});

test("health is OK only while a connected DMX interface is sending frames", () => {
  const assessment = assessDmxHealth(status(), 10_100);

  assert.equal(assessment.statusCode, 200);
  assert.equal(assessment.body.ok, true);
  assert.equal(assessment.body.status, "healthy");
});

test("health is unavailable while the DMX interface is missing or reconnecting", () => {
  for (const state of ["searching", "error"] as const) {
    const assessment = assessDmxHealth(status({ state, message: "DMX unavailable." }), 10_100);

    assert.equal(assessment.statusCode, 503);
    assert.equal(assessment.body.ok, false);
    assert.equal(assessment.body.reason, "DMX unavailable.");
  }
});

test("health is unavailable if a connected interface stops sending frames", () => {
  const assessment = assessDmxHealth(status(), 10_000 + DMX_FRAME_STALE_AFTER_MS + 1);

  assert.equal(assessment.statusCode, 503);
  assert.match(assessment.body.reason ?? "", /not sending frames/i);
});

test("health is OK in explicitly configured simulation mode", () => {
  const assessment = assessDmxHealth(status({
    state: "simulation",
    message: "DMX output disabled by OPEN_DMX_DISABLED.",
    lastFrameAt: undefined,
  }));

  assert.equal(assessment.statusCode, 200);
  assert.equal(assessment.body.ok, true);
});

test("health response reports the assessed service status", async () => {
  const result = await checkHealth(async () => ({ getDmxStatus: () => status({
    state: "searching",
    message: "No Open DMX interface found.",
    lastFrameAt: undefined,
  }) }));

  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, {
    ok: false,
    status: "unhealthy",
    reason: "No Open DMX interface found.",
    dmx: {
      state: "searching",
      message: "No Open DMX interface found.",
      framesSent: 42,
      lastFrameAt: undefined,
    },
  });
});

test("GET /health returns 500 when the console engine cannot initialize", async () => {
  const result = await checkHealth(async () => {
    throw new Error("Initialization failed.");
  });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, {
    ok: false,
    status: "error",
    error: "Initialization failed.",
  });
});
