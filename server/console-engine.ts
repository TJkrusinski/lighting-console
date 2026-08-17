import { randomUUID } from "node:crypto";
import { fixtureProfiles } from "@/lib/fixture-profiles";
import { validatePatch } from "@/lib/console-validation";
import type {
  ConsoleSnapshot,
  PatchedFixture,
  PersistedConsoleState,
  Preset,
  TransitionStatus,
} from "@/lib/console-types";
import { OpenDmxOutput } from "./open-dmx";
import { loadState, saveState } from "./store";

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUniverse(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length !== 512 || value.some((channel) => !Number.isFinite(Number(channel)))) {
    throw new Error(`${label} must contain exactly 512 numeric DMX values.`);
  }
  return value.map((channel) => clampByte(Number(channel)));
}

export function parseConsoleBackup(value: unknown): PersistedConsoleState {
  if (!isRecord(value)) throw new Error("The selected file is not a console backup.");
  if (value.format !== undefined && value.format !== "open-dmx-console") {
    throw new Error("This backup belongs to a different application.");
  }
  if (value.version !== undefined && value.version !== 1) {
    throw new Error(`Backup version ${String(value.version)} is not supported.`);
  }

  const candidate = isRecord(value.state) ? value.state : value;
  if (!Array.isArray(candidate.fixtures) || !Array.isArray(candidate.presets)) {
    throw new Error("The backup is missing fixture or preset data.");
  }

  const fixtures: PatchedFixture[] = candidate.fixtures.map((fixture, index) => {
    if (!isRecord(fixture)) throw new Error(`Fixture ${index + 1} is invalid.`);
    return {
      id: String(fixture.id ?? ""),
      name: String(fixture.name ?? "").trim().slice(0, 80) || "Fixture",
      profileId: String(fixture.profileId ?? ""),
      modeId: String(fixture.modeId ?? ""),
      address: Number(fixture.address),
    };
  });
  const patchErrors = validatePatch(fixtures);
  if (patchErrors.length) throw new Error(patchErrors.join(" "));

  const presetIds = new Set<string>();
  const presets: Preset[] = candidate.presets.map((preset, index) => {
    if (!isRecord(preset)) throw new Error(`Preset ${index + 1} is invalid.`);
    const id = String(preset.id ?? "");
    if (!id || presetIds.has(id)) throw new Error(`Preset ${index + 1} has a missing or duplicate ID.`);
    presetIds.add(id);
    const createdAt = String(preset.createdAt ?? "");
    if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
      throw new Error(`Preset ${index + 1} has an invalid creation date.`);
    }
    return {
      id,
      name: String(preset.name ?? "").trim().slice(0, 80) || `Look ${index + 1}`,
      createdAt,
      values: parseUniverse(preset.values, `Preset ${index + 1}`),
    };
  });

  const transitionMs = Number(candidate.transitionMs);
  if (!Number.isFinite(transitionMs) || transitionMs < 0 || transitionMs > 3_600_000) {
    throw new Error("Transition time must be between 0 and 3600000 milliseconds.");
  }

  return {
    fixtures,
    presets,
    liveValues: parseUniverse(candidate.liveValues, "Live universe"),
    transitionMs,
  };
}

export function interpolateUniverse(start: number[], target: number[], progress: number) {
  const normalizedProgress = Math.max(0, Math.min(1, progress));
  return Array.from({ length: 512 }, (_, index) => {
    const from = clampByte(start[index] ?? 0);
    const to = clampByte(target[index] ?? 0);
    return clampByte(from + (to - from) * normalizedProgress);
  });
}

export function overwritePresetValues(presets: Preset[], id: string, liveValues: number[]) {
  const preset = presets.find((candidate) => candidate.id === id);
  if (!preset) throw new Error("Preset not found.");
  preset.values = Array.from({ length: 512 }, (_, index) => clampByte(liveValues[index] ?? 0));
  return preset;
}

export class ConsoleEngine {
  private state!: PersistedConsoleState;
  private output = new OpenDmxOutput();
  private transition: TransitionStatus = { active: false };
  private transitionTimer?: NodeJS.Timeout;
  private persistTimer?: NodeJS.Timeout;

  async initialize() {
    this.state = await loadState();
    this.output.setUniverse(this.state.liveValues);
    await this.output.start();
    return this;
  }

  snapshot(): ConsoleSnapshot {
    return {
      ...this.state,
      fixtures: this.state.fixtures.map((fixture) => ({ ...fixture })),
      presets: this.state.presets.map((preset) => ({ ...preset, values: [...preset.values] })),
      liveValues: [...this.state.liveValues],
      profiles: fixtureProfiles,
      dmx: this.output.getStatus(),
      transition: { ...this.transition },
    };
  }

  getDmxStatus() {
    return this.output.getStatus();
  }

  async setPatch(fixtures: PatchedFixture[]) {
    const clean = fixtures.map((fixture) => ({
      id: String(fixture.id),
      name: String(fixture.name).trim().slice(0, 80) || "Fixture",
      profileId: String(fixture.profileId),
      modeId: String(fixture.modeId),
      address: Number(fixture.address),
    }));
    const errors = validatePatch(clean);
    if (errors.length) throw new Error(errors.join(" "));
    this.state.fixtures = clean;
    await this.persist();
    return this.snapshot();
  }

  setLiveValues(updates: Record<string, unknown>) {
    this.cancelTransition();
    for (const [channelText, rawValue] of Object.entries(updates)) {
      const channel = Number(channelText);
      const value = Number(rawValue);
      if (Number.isInteger(channel) && channel >= 1 && channel <= 512 && Number.isFinite(value)) {
        this.state.liveValues[channel - 1] = clampByte(value);
      }
    }
    this.output.setUniverse(this.state.liveValues);
    this.schedulePersist();
    return this.snapshot();
  }

  async setTransitionTime(transitionMs: number) {
    this.state.transitionMs = Math.max(0, Math.min(3_600_000, Number(transitionMs) || 0));
    await this.persist();
    return this.snapshot();
  }

  async capturePreset(name: string) {
    const preset = {
      id: randomUUID(),
      name: name.trim().slice(0, 80) || `Look ${this.state.presets.length + 1}`,
      values: [...this.state.liveValues],
      createdAt: new Date().toISOString(),
    };
    this.state.presets.push(preset);
    await this.persist();
    return preset;
  }

  async overwritePreset(id: string) {
    overwritePresetValues(this.state.presets, id, this.state.liveValues);
    await this.persist();
    return this.snapshot();
  }

  async deletePreset(id: string) {
    const count = this.state.presets.length;
    this.state.presets = this.state.presets.filter((preset) => preset.id !== id);
    if (this.state.presets.length === count) throw new Error("Preset not found.");
    await this.persist();
    return this.snapshot();
  }

  recallPreset(id: string, requestedDuration?: number) {
    const preset = this.state.presets.find((candidate) => candidate.id === id);
    if (!preset) throw new Error("Preset not found.");
    const duration = Math.max(
      0,
      Math.min(3_600_000, Number.isFinite(requestedDuration) ? Number(requestedDuration) : this.state.transitionMs),
    );
    this.cancelTransition();
    const start = [...this.state.liveValues];
    const target = Array.from({ length: 512 }, (_, index) => clampByte(preset.values[index] ?? 0));
    const startedAt = Date.now();
    this.transition = {
      active: duration > 0,
      startedAt,
      durationMs: duration,
      presetId: preset.id,
      presetName: preset.name,
    };

    const render = () => {
      const progress = duration === 0 ? 1 : Math.min(1, (Date.now() - startedAt) / duration);
      this.state.liveValues = interpolateUniverse(start, target, progress);
      this.output.setUniverse(this.state.liveValues);
      if (progress >= 1) {
        this.cancelTransition(false);
        void this.persist();
      }
    };
    render();
    if (duration > 0) this.transitionTimer = setInterval(render, 25);
    return this.snapshot();
  }

  async reconnectDmx() {
    await this.output.reconnect();
    return this.snapshot();
  }

  exportState(): PersistedConsoleState {
    return {
      fixtures: this.state.fixtures.map((fixture) => ({ ...fixture })),
      presets: this.state.presets.map((preset) => ({ ...preset, values: [...preset.values] })),
      liveValues: [...this.state.liveValues],
      transitionMs: this.state.transitionMs,
    };
  }

  async importState(backup: unknown) {
    const nextState = parseConsoleBackup(backup);
    this.cancelTransition();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    this.state = nextState;
    this.output.setUniverse(this.state.liveValues);
    await this.persist();
    return this.snapshot();
  }

  async shutdown() {
    this.cancelTransition();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    await this.persist();
    await this.output.stop();
  }

  private cancelTransition(clearMetadata = true) {
    if (this.transitionTimer) clearInterval(this.transitionTimer);
    this.transitionTimer = undefined;
    this.transition = clearMetadata ? { active: false } : { ...this.transition, active: false };
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist();
    }, 250);
  }

  private async persist() {
    await saveState(this.state);
  }
}
