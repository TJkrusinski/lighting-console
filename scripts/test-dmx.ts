import { getMode } from "../lib/fixture-profiles";
import { OpenDmxOutput } from "../server/open-dmx";
import { loadState } from "../server/store";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const savedState = await loadState();
const firstFixture = savedState.fixtures[0];
const firstMode = firstFixture ? getMode(firstFixture.profileId, firstFixture.modeId) : undefined;
const startAddress = positiveInteger(argument("start"), firstFixture?.address ?? 1);
const channelCount = positiveInteger(argument("channels"), firstMode?.footprint ?? 2);
const holdMs = positiveInteger(argument("hold"), 1500);
const requestedPort = argument("port");
const requestedSerial = argument("serial");

if (requestedPort) process.env.OPEN_DMX_PORT = requestedPort;
if (requestedSerial) process.env.OPEN_DMX_SERIAL = requestedSerial;
delete process.env.OPEN_DMX_DISABLED;

if (startAddress + channelCount - 1 > 512) {
  console.error("The selected channel range extends past DMX address 512.");
  process.exitCode = 1;
} else {
  const output = new OpenDmxOutput();
  let interrupted = false;
  process.once("SIGINT", () => { interrupted = true; });

  try {
    output.setUniverse(savedState.liveValues);
    await output.start();
    const initialStatus = output.getStatus();
    if (initialStatus.state !== "connected") {
      throw new Error(initialStatus.message);
    }

    console.log(`Connected: ${initialStatus.port}${initialStatus.serialNumber ? ` (${initialStatus.serialNumber})` : ""}`);
    console.log(`Testing channels ${startAddress}-${startAddress + channelCount - 1}; each step holds for ${holdMs} ms.`);
    console.log("Press Ctrl+C to stop. Saved console values will be restored before closing.");

    const steps = [
      { label: "blackout", intensity: 0, other: 128 },
      { label: "low", intensity: 32, other: 32 },
      { label: "half", intensity: 128, other: 128 },
      { label: "full", intensity: 255, other: 192 },
      { label: "low / alternate parameters", intensity: 48, other: 224 },
      { label: "full / alternate parameters", intensity: 255, other: 64 },
    ];

    for (const step of steps) {
      if (interrupted) break;
      const universe = [...savedState.liveValues];
      for (let offset = 0; offset < channelCount; offset += 1) {
        universe[startAddress - 1 + offset] = offset === 0 ? step.intensity : step.other;
      }
      output.setUniverse(universe);
      console.log(`${step.label.padEnd(29)} CH ${startAddress}=${step.intensity}, remaining test channels=${step.other}`);
      await wait(holdMs);
    }

    output.setUniverse(savedState.liveValues);
    await wait(500);
    const finalStatus = output.getStatus();
    console.log(`Test complete. ${finalStatus.framesSent} DMX frames sent; restored saved console values.`);
  } catch (error) {
    console.error(`DMX test failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Stop the console/PM2 process first, verify the USB cable, or select the interface with --serial/--port.");
    process.exitCode = 1;
  } finally {
    await output.stop();
  }
}
