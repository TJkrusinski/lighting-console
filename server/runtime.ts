import { ConsoleEngine } from "./console-engine";

declare global {
  var lightingConsoleEngine: Promise<ConsoleEngine> | undefined;
}

export function getConsoleEngine() {
  if (!globalThis.lightingConsoleEngine) {
    globalThis.lightingConsoleEngine = new ConsoleEngine().initialize();
  }
  return globalThis.lightingConsoleEngine;
}

export async function shutdownConsoleEngine() {
  if (!globalThis.lightingConsoleEngine) return;
  const engine = await globalThis.lightingConsoleEngine;
  await engine.shutdown();
  globalThis.lightingConsoleEngine = undefined;
}
