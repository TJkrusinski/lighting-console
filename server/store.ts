import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PersistedConsoleState } from "@/lib/console-types";

const EMPTY_UNIVERSE = () => Array.from({ length: 512 }, () => 0);

export const defaultState = (): PersistedConsoleState => ({
  fixtures: [],
  presets: [],
  liveValues: EMPTY_UNIVERSE(),
  transitionMs: 2000,
});

function dataFile() {
  const directory = process.env.OPEN_DMX_DATA_DIR?.trim() || path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
  return { directory, file: path.join(directory, "console-state.json") };
}

function normalizeState(value: Partial<PersistedConsoleState>): PersistedConsoleState {
  const fallback = defaultState();
  return {
    fixtures: Array.isArray(value.fixtures) ? value.fixtures : [],
    presets: Array.isArray(value.presets) ? value.presets : [],
    liveValues: Array.from({ length: 512 }, (_, index) => {
      const candidate = Number(value.liveValues?.[index] ?? 0);
      return Math.max(0, Math.min(255, Math.round(candidate)));
    }),
    transitionMs: Number.isFinite(value.transitionMs)
      ? Math.max(0, Math.min(3_600_000, Number(value.transitionMs)))
      : fallback.transitionMs,
  };
}

export async function loadState(): Promise<PersistedConsoleState> {
  const { file } = dataFile();
  try {
    return normalizeState(JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("Could not load console state; starting clean.", error);
    }
    return defaultState();
  }
}

export async function saveState(state: PersistedConsoleState): Promise<void> {
  const { directory, file } = dataFile();
  const temporary = `${file}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(/* turbopackIgnore: true */ temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(/* turbopackIgnore: true */ temporary, file);
}
