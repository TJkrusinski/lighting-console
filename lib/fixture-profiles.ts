import type { ChannelDefinition, FixtureProfile } from "./console-types";

const intensity = (offset = 1): ChannelDefinition => ({
  offset,
  name: "Intensity",
  shortName: "DIM",
  kind: "intensity",
  defaultValue: 0,
  displayMin: 0,
  displayMax: 100,
  unit: "%",
});

const cct = (
  offset: number,
  min: number,
  max: number,
  defaultKelvin = 5600,
): ChannelDefinition => ({
  offset,
  name: "Color temperature",
  shortName: "CCT",
  kind: "temperature",
  defaultValue: Math.round(((defaultKelvin - min) / (max - min)) * 255),
  displayMin: min,
  displayMax: max,
  unit: "K",
});

export const fixtureProfiles: FixtureProfile[] = [
  {
    id: "amaran-f21x",
    manufacturer: "amaran",
    model: "F21x",
    family: "Flexible mat",
    accent: "#f3b51b",
    dmxCapable: true,
    sourceUrl:
      "https://docs.aputure.com/hubfs/Knowledge%20Base/amaran/F21-F22/All%20Files/F21X-F22X-Pro-DMX-Profile-Specification-V1.0-.pdf",
    modes: [
      {
        id: "cct-8",
        name: "CCT · 8 bit",
        footprint: 2,
        channels: [intensity(), cct(2, 2500, 7500)],
      },
      {
        id: "fx-8",
        name: "FX · 8 bit",
        footprint: 5,
        note: "Effect selection and rate follow the official F21x/F22x profile.",
        channels: [
          intensity(),
          cct(2, 2500, 7500),
          { offset: 3, name: "Effect trigger", shortName: "TRIG", kind: "control", defaultValue: 0 },
          { offset: 4, name: "Effect selection", shortName: "FX", kind: "effect", defaultValue: 0 },
          { offset: 5, name: "Effect frequency", shortName: "RATE", kind: "effect", defaultValue: 0 },
        ],
      },
    ],
  },
  {
    id: "godox-f200bi-k2",
    manufacturer: "Godox KNOWLED",
    model: "F200Bi K2",
    family: "Flexible mat · 2-light kit",
    accent: "#e96f45",
    dmxCapable: true,
    sourceUrl: "https://www.godox.com/Downloads/KNOWLED_F200Bi.pdf",
    modes: [
      {
        id: "cct-8",
        name: "CCT · 8 bit",
        footprint: 2,
        note: "Patch one fixture instance for each F200Bi head in the K2 kit.",
        channels: [intensity(), cct(2, 2700, 8500)],
      },
      {
        id: "fx-8",
        name: "FX · 8 bit",
        footprint: 5,
        channels: [
          intensity(),
          { offset: 2, name: "Effect type", shortName: "FX", kind: "effect", defaultValue: 0 },
          { offset: 3, name: "Effect parameter 1", shortName: "FX 1", kind: "effect", defaultValue: 0 },
          { offset: 4, name: "Effect parameter 2", shortName: "FX 2", kind: "effect", defaultValue: 0 },
          { offset: 5, name: "Effect parameter 3", shortName: "FX 3", kind: "effect", defaultValue: 0 },
        ],
      },
      {
        id: "ultimate-8",
        name: "Ultimate · 8 bit",
        footprint: 6,
        note: "Channel 2 selects CCT or FX; channels 3–6 change function with that selection.",
        channels: [
          intensity(),
          { offset: 2, name: "Mode selection", shortName: "MODE", kind: "control", defaultValue: 0 },
          { offset: 3, name: "Color / FX parameter 1", shortName: "PAR 1", kind: "control", defaultValue: 0 },
          { offset: 4, name: "FX parameter 2", shortName: "PAR 2", kind: "effect", defaultValue: 0 },
          { offset: 5, name: "FX parameter 3", shortName: "PAR 3", kind: "effect", defaultValue: 0 },
          { offset: 6, name: "FX parameter 4", shortName: "PAR 4", kind: "effect", defaultValue: 0 },
        ],
      },
    ],
  },
  {
    id: "godox-f600bi",
    manufacturer: "Godox KNOWLED",
    model: "F600Bi",
    family: "Flexible mat",
    accent: "#ef7f44",
    dmxCapable: true,
    sourceUrl:
      "https://www.godox.com/static/upload/file/20230713/1689216265265540.pdf",
    modes: [
      {
        id: "cct-8",
        name: "CCT · 8 bit",
        footprint: 2,
        channels: [intensity(), cct(2, 2700, 8500)],
      },
      {
        id: "fx-8",
        name: "FX · 8 bit",
        footprint: 5,
        channels: [
          intensity(),
          { offset: 2, name: "Effect type", shortName: "FX", kind: "effect", defaultValue: 0 },
          { offset: 3, name: "Effect parameter A", shortName: "FX A", kind: "effect", defaultValue: 0 },
          { offset: 4, name: "Effect parameter B", shortName: "FX B", kind: "effect", defaultValue: 0 },
          { offset: 5, name: "Effect parameter C", shortName: "FX C", kind: "effect", defaultValue: 0 },
        ],
      },
    ],
  },
  {
    id: "aputure-storm-80c",
    manufacturer: "Aputure",
    model: "STORM 80c",
    family: "Point source",
    accent: "#78aaff",
    dmxCapable: true,
    sourceUrl:
      "https://help.aputure.com/en/sidus-link-pro/creating-custom-dmx-profiles",
    modes: [
      {
        id: "cct-rgb-8",
        name: "CCT + RGB · 8 bit",
        footprint: 7,
        note: "Aputure profile 1 — compact CCT and direct RGB control.",
        channels: [
          intensity(),
          cct(2, 1800, 20000),
          { offset: 3, name: "Green / magenta", shortName: "±G", kind: "color", defaultValue: 133 },
          { offset: 4, name: "White / RGB crossfade", shortName: "XFADE", kind: "control", defaultValue: 0 },
          { offset: 5, name: "Red", shortName: "RED", kind: "color", defaultValue: 0 },
          { offset: 6, name: "Green", shortName: "GREEN", kind: "color", defaultValue: 0 },
          { offset: 7, name: "Blue", shortName: "BLUE", kind: "color", defaultValue: 0 },
        ],
      },
    ],
  },
  {
    id: "aputure-storm-700x",
    manufacturer: "Aputure",
    model: "STORM 700x",
    family: "Point source",
    accent: "#5f8fe8",
    dmxCapable: true,
    sourceUrl:
      "https://docs.aputure.com/hubfs/Knowledge%20Base/Aputure/STORM%20700x/documents/STORM%20700x%20400x%20DMX%20Profile%20Specification%201.1.pdf",
    modes: [
      {
        id: "profile-1-cct-plus-8",
        name: "Profile 1 · CCT+ · 8 bit",
        footprint: 3,
        channels: [
          intensity(),
          cct(2, 2500, 10000, 3200),
          { offset: 3, name: "Green / magenta", shortName: "±G", kind: "color", defaultValue: 137 },
        ],
      },
      {
        id: "profile-3-cct-control-8",
        name: "Profile 3 · CCT+ & control · 8 bit",
        footprint: 6,
        note: "Set the fixture fan setting to DMX Controlled to use channel 6.",
        channels: [
          intensity(),
          cct(2, 2500, 10000, 3200),
          { offset: 3, name: "Green / magenta", shortName: "±G", kind: "color", defaultValue: 137 },
          { offset: 4, name: "Strobe", shortName: "STRB", kind: "effect", defaultValue: 0 },
          { offset: 5, name: "Fixture control", shortName: "CTRL", kind: "control", defaultValue: 0 },
          { offset: 6, name: "Fan mode", shortName: "FAN", kind: "control", defaultValue: 0 },
        ],
      },
      {
        id: "profile-5-cct-fx-control-8",
        name: "Profile 5 · CCT+ FX & control · 8 bit",
        footprint: 11,
        note: "Set the fixture fan setting to DMX Controlled to use channel 11.",
        channels: [
          intensity(),
          cct(2, 2500, 10000, 3200),
          { offset: 3, name: "Green / magenta", shortName: "±G", kind: "color", defaultValue: 137 },
          { offset: 4, name: "FX crossfade", shortName: "XFADE", kind: "effect", defaultValue: 0 },
          { offset: 5, name: "FX trigger", shortName: "TRIG", kind: "effect", defaultValue: 0 },
          { offset: 6, name: "FX selection", shortName: "FX", kind: "effect", defaultValue: 0 },
          { offset: 7, name: "FX frequency", shortName: "RATE", kind: "effect", defaultValue: 0 },
          { offset: 8, name: "FX variable", shortName: "VAR", kind: "effect", defaultValue: 0 },
          { offset: 9, name: "Strobe", shortName: "STRB", kind: "effect", defaultValue: 0 },
          { offset: 10, name: "Fixture control", shortName: "CTRL", kind: "control", defaultValue: 0 },
          { offset: 11, name: "Fan mode", shortName: "FAN", kind: "control", defaultValue: 0 },
        ],
      },
    ],
  },
];

export function getProfile(profileId: string) {
  return fixtureProfiles.find((profile) => profile.id === profileId);
}

export function getMode(profileId: string, modeId: string) {
  return getProfile(profileId)?.modes.find((mode) => mode.id === modeId);
}
