export type ChannelKind =
  | "intensity"
  | "temperature"
  | "color"
  | "effect"
  | "control";

export interface ChannelDefinition {
  offset: number;
  name: string;
  shortName: string;
  kind: ChannelKind;
  defaultValue: number;
  displayMin?: number;
  displayMax?: number;
  unit?: string;
}

export interface FixtureMode {
  id: string;
  name: string;
  footprint: number;
  note?: string;
  channels: ChannelDefinition[];
}

export interface FixtureProfile {
  id: string;
  manufacturer: string;
  model: string;
  family: string;
  accent: string;
  dmxCapable: boolean;
  warning?: string;
  sourceUrl: string;
  modes: FixtureMode[];
}

export interface PatchedFixture {
  id: string;
  name: string;
  profileId: string;
  modeId: string;
  address: number;
}

export interface Preset {
  id: string;
  name: string;
  values: number[];
  createdAt: string;
}

export interface PersistedConsoleState {
  fixtures: PatchedFixture[];
  presets: Preset[];
  liveValues: number[];
  transitionMs: number;
}

export interface ConsoleBackup {
  format: "open-dmx-console";
  version: 1;
  exportedAt: string;
  state: PersistedConsoleState;
}

export interface DmxStatus {
  state: "searching" | "connected" | "simulation" | "error";
  port?: string;
  serialNumber?: string;
  message: string;
  framesSent: number;
  lastFrameAt?: number;
}

export interface TransitionStatus {
  active: boolean;
  startedAt?: number;
  durationMs?: number;
  presetId?: string;
  presetName?: string;
}

export interface ConsoleSnapshot extends PersistedConsoleState {
  profiles: FixtureProfile[];
  dmx: DmxStatus;
  transition: TransitionStatus;
}
