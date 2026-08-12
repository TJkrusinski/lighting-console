import assert from "node:assert/strict";
import test from "node:test";
import { createClientId } from "../lib/client-id";
import { fixtureProfiles, getMode } from "../lib/fixture-profiles";
import { validatePatch } from "../lib/console-validation";
import { interpolateUniverse, overwritePresetValues, parseConsoleBackup } from "../server/console-engine";

test("creates browser IDs when randomUUID is unavailable", () => {
  const deterministicCrypto = {
    getRandomValues(bytes: Uint8Array) {
      bytes.fill(0xab);
      return bytes;
    },
  } as unknown as Crypto;

  assert.equal(createClientId(deterministicCrypto), "abababab-abab-4bab-abab-abababababab");
  assert.match(createClientId(null), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("ships the verified DMX fixture library", () => {
  assert.deepEqual(
    fixtureProfiles.map((profile) => profile.model),
    ["F21x", "F200Bi K2", "F600Bi", "STORM 80c", "STORM 700x"],
  );
  assert.equal(getMode("amaran-f21x", "cct-8")?.footprint, 2);
  assert.equal(getMode("aputure-storm-80c", "cct-rgb-8")?.footprint, 7);
  assert.equal(getMode("godox-f200bi-k2", "ultimate-8")?.footprint, 6);
  assert.equal(getMode("aputure-storm-700x", "profile-5-cct-fx-control-8")?.footprint, 11);
});

test("patch validation permits overlaps and any starting channel", () => {
  const base = { profileId: "amaran-f21x", modeId: "cct-8" };
  assert.deepEqual(validatePatch([
    { id: "a", name: "Key", address: 1, ...base },
    { id: "b", name: "Fill", address: 3, ...base },
  ]), []);
  assert.deepEqual(validatePatch([
    { id: "a", name: "Key", address: 1, ...base },
    { id: "b", name: "Fill", address: 2, ...base },
  ]), []);
  assert.deepEqual(validatePatch([
    { id: "a", name: "Key", address: 512, ...base },
  ]), []);
  assert.match(validatePatch([
    { id: "a", name: "Key", address: 513, ...base },
  ])[0], /1 to 512/);
});

test("fades linearly and always returns one complete DMX universe", () => {
  const halfway = interpolateUniverse([0, 255], [255, 0], 0.5);
  assert.equal(halfway.length, 512);
  assert.equal(halfway[0], 128);
  assert.equal(halfway[1], 128);
  assert.equal(halfway[511], 0);
});

test("overwrites only a preset's captured values", () => {
  const createdAt = "2026-08-11T12:00:00.000Z";
  const presets = [{ id: "look", name: "Interview", createdAt, values: Array(512).fill(0) }];
  const liveValues = Array(512).fill(0);
  liveValues[0] = 123;

  const overwritten = overwritePresetValues(presets, "look", liveValues);

  assert.equal(overwritten.id, "look");
  assert.equal(overwritten.name, "Interview");
  assert.equal(overwritten.createdAt, createdAt);
  assert.equal(overwritten.values[0], 123);
  liveValues[0] = 255;
  assert.equal(overwritten.values[0], 123);
  assert.throws(() => overwritePresetValues(presets, "missing", liveValues), /not found/i);
});

test("console backups restore the complete validated state", () => {
  const values = Array.from({ length: 512 }, () => 12);
  const state = parseConsoleBackup({
    format: "open-dmx-console",
    version: 1,
    exportedAt: "2026-08-11T12:00:00.000Z",
    state: {
      fixtures: [{ id: "key", name: "Key", profileId: "amaran-f21x", modeId: "cct-8", address: 1 }],
      presets: [{ id: "look", name: "Interview", createdAt: "2026-08-11T12:00:00.000Z", values }],
      liveValues: values,
      transitionMs: 2500,
    },
  });

  assert.equal(state.fixtures[0].name, "Key");
  assert.equal(state.presets[0].values.length, 512);
  assert.equal(state.liveValues[511], 12);
  assert.equal(state.transitionMs, 2500);
  assert.throws(() => parseConsoleBackup({ fixtures: [], presets: [], liveValues: [0], transitionMs: 0 }), /512/);
});
