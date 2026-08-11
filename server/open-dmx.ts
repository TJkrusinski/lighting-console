import { existsSync } from "node:fs";
import FTDI from "ftdi-d2xx";
import { SerialPort } from "serialport";
import type { DmxStatus } from "@/lib/console-types";

const OPEN_DMX_VENDOR = "0403";
const OPEN_DMX_PRODUCT = "6001";
const FRAME_LENGTH = 513;
const FRAME_TIME_US = 33_333;
const DMX_BREAK_US = 110;
const DMX_MAB_US = 16;

type FtdiDevice = Awaited<ReturnType<typeof FTDI.openDevice>>;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function busyWaitMicroseconds(microseconds: number) {
  const until = process.hrtime.bigint() + BigInt(microseconds * 1000);
  while (process.hrtime.bigint() < until) {
    // DMX break and mark-after-break timing is shorter than Node timer resolution.
  }
}

function elapsedMicroseconds(startedAt: bigint) {
  return Number((process.hrtime.bigint() - startedAt) / 1000n);
}

function normalizeUsbId(value?: string) {
  return value?.toLowerCase().replace(/^0x/, "").padStart(4, "0");
}

function outgoingPortPath(portPath: string) {
  if (process.platform !== "darwin" || !portPath.startsWith("/dev/tty.")) return portPath;
  const calloutPath = portPath.replace("/dev/tty.", "/dev/cu.");
  return existsSync(calloutPath) ? calloutPath : portPath;
}

function write(port: SerialPort, data: Buffer) {
  return new Promise<void>((resolve, reject) => {
    port.write(data, (writeError) => {
      if (writeError) return reject(writeError);
      port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
    });
  });
}

function setBreak(port: SerialPort, enabled: boolean) {
  return new Promise<void>((resolve, reject) => {
    port.set({ brk: enabled }, (error) => (error ? reject(error) : resolve()));
  });
}

function initializeOpenDmxLines(port: SerialPort) {
  return new Promise<void>((resolve, reject) => {
    // Open DMX interfaces use the FTDI UART as a raw DMX transmitter. RTS must
    // remain deasserted; some VCP drivers assert it automatically when opening
    // the port, which prevents a valid DMX waveform on compatible interfaces.
    port.set({ rts: false, brk: false }, (error) => (error ? reject(error) : resolve()));
  });
}

function open(port: SerialPort) {
  return new Promise<void>((resolve, reject) => {
    port.open((error) => (error ? reject(error) : resolve()));
  });
}

export class OpenDmxOutput {
  private port?: SerialPort;
  private directDevice?: FtdiDevice;
  private frame = Buffer.alloc(FRAME_LENGTH);
  private running = false;
  private reconnectTimer?: NodeJS.Timeout;
  private status: DmxStatus = {
    state: "searching",
    message: "Looking for an ENTTEC Open DMX USB interface…",
    framesSent: 0,
  };

  setUniverse(values: number[]) {
    for (let index = 0; index < 512; index += 1) {
      this.frame[index + 1] = Math.max(0, Math.min(255, Math.round(values[index] ?? 0)));
    }
  }

  getStatus(): DmxStatus {
    return { ...this.status };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    if (["1", "true", "yes"].includes((process.env.OPEN_DMX_DISABLED ?? "").toLowerCase())) {
      this.status = {
        state: "simulation",
        message: "DMX output disabled by OPEN_DMX_DISABLED.",
        framesSent: 0,
      };
      return;
    }
    await this.connect();
  }

  async reconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.port?.isOpen) {
      await new Promise<void>((resolve) => this.port?.close(() => resolve()));
    }
    if (this.directDevice?.is_connected) await this.directDevice.close();
    this.port = undefined;
    this.directDevice = undefined;
    this.status = {
      state: "searching",
      message: "Rescanning DMX interfaces…",
      framesSent: this.status.framesSent,
    };
    await this.connect();
  }

  async stop() {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const port = this.port;
    const directDevice = this.directDevice;
    this.port = undefined;
    this.directDevice = undefined;
    if (port?.isOpen) {
      await new Promise<void>((resolve) => port.close(() => resolve()));
    }
    if (directDevice?.is_connected) await directDevice.close();
    this.status = {
      state: "searching",
      message: "DMX output stopped.",
      framesSent: this.status.framesSent,
    };
  }

  private async connect() {
    if (!this.running || this.port?.isOpen || this.directDevice?.is_connected) return;
    try {
      if (process.platform === "darwin" || process.platform === "win32") {
        await this.connectDirect();
        return;
      }

      await this.connectSerial();
    } catch (error) {
      this.handleDisconnect(error);
    }
  }

  private async connectDirect() {
    const requestedSerial = process.env.OPEN_DMX_SERIAL?.trim();
    const devices = await FTDI.getDeviceInfoList();
    const match = devices.find(
      (candidate) =>
        candidate.usb_vid === Number.parseInt(OPEN_DMX_VENDOR, 16) &&
        candidate.usb_pid === Number.parseInt(OPEN_DMX_PRODUCT, 16) &&
        (!requestedSerial || candidate.serial_number === requestedSerial),
    );

    if (!match) {
      this.status = {
        state: "searching",
        message: requestedSerial
          ? `No Open DMX interface with serial ${requestedSerial} found.`
          : "No FT232R Open DMX interface found. Output is in preview mode.",
        framesSent: this.status.framesSent,
      };
      this.scheduleReconnect();
      return;
    }

    const device = await FTDI.openDevice(match.serial_number);
    device.resetDevice();
    device.setBaudRate(250_000);
    device.setDataCharacteristics(FTDI.FT_BITS_8, FTDI.FT_STOP_BITS_2, FTDI.FT_PARITY_NONE);
    device.setFlowControl(FTDI.FT_FLOW_NONE, 0, 0);
    device.clrRts();
    device.setBreakOff();
    device.purge(FTDI.FT_PURGE_RX | FTDI.FT_PURGE_TX);
    device.setTimeouts(1000, 1000);
    this.directDevice = device;
    this.status = {
      state: "connected",
      port: `D2XX:${match.serial_number}`,
      serialNumber: match.serial_number,
      message: `Streaming DMX through the direct FTDI driver (250000 baud, 8N2, 30 Hz).`,
      framesSent: this.status.framesSent,
    };
    void this.outputDirectLoop(device);
  }

  private async connectSerial() {
    const requestedPath = process.env.OPEN_DMX_PORT?.trim();
    const ports = await SerialPort.list();
    const match = requestedPath
      ? ports.find((candidate) => candidate.path === requestedPath)
      : ports.find(
          (candidate) =>
            (normalizeUsbId(candidate.vendorId) === OPEN_DMX_VENDOR &&
              normalizeUsbId(candidate.productId) === OPEN_DMX_PRODUCT) ||
            (candidate.manufacturer?.toLowerCase().includes("ftdi") === true &&
              /usbserial|ftdi/i.test(candidate.path)),
        );

    if (!match && !requestedPath) {
      this.status = {
        state: "searching",
        message: "No FT232R Open DMX interface found. Output is in preview mode.",
        framesSent: this.status.framesSent,
      };
      this.scheduleReconnect();
      return;
    }

    const portPath = outgoingPortPath(requestedPath ?? match!.path);
    const port = new SerialPort({
      path: portPath,
      baudRate: 250_000,
      dataBits: 8,
      stopBits: 2,
      parity: "none",
      autoOpen: false,
    });
    port.on("error", (error) => this.handleDisconnect(error));
    port.on("close", () => this.handleDisconnect(new Error("Serial port closed.")));
    await open(port);
    await initializeOpenDmxLines(port);
    this.port = port;
    this.status = {
      state: "connected",
      port: portPath,
      serialNumber: match?.serialNumber,
      message: `Streaming DMX at 250000 baud (8N2, RTS low) on ${portPath}.`,
      framesSent: this.status.framesSent,
    };
    void this.outputLoop(port);
  }

  private async outputDirectLoop(device: FtdiDevice) {
    try {
      await delay(1);
      while (this.running && this.directDevice === device && device.is_connected) {
        const frameStartedAt = process.hrtime.bigint();
        device.setBreakOn();
        busyWaitMicroseconds(DMX_BREAK_US);
        device.setBreakOff();
        busyWaitMicroseconds(DMX_MAB_US);
        const bytesWritten = await device.write(Uint8Array.from(this.frame));
        if (bytesWritten !== FRAME_LENGTH) {
          throw new Error(`FTDI accepted ${bytesWritten} of ${FRAME_LENGTH} DMX bytes.`);
        }
        this.status.framesSent += 1;
        const remainingUs = FRAME_TIME_US - elapsedMicroseconds(frameStartedAt);
        if (remainingUs >= 1000) await delay(Math.floor(remainingUs / 1000));
        const finalUs = FRAME_TIME_US - elapsedMicroseconds(frameStartedAt);
        if (finalUs > 0) busyWaitMicroseconds(finalUs);
      }
    } catch (error) {
      this.handleDisconnect(error);
    }
  }

  private async outputLoop(port: SerialPort) {
    try {
      while (this.running && this.port === port && port.isOpen) {
        await setBreak(port, true);
        busyWaitMicroseconds(DMX_BREAK_US);
        await setBreak(port, false);
        busyWaitMicroseconds(DMX_MAB_US);
        await write(port, Buffer.from(this.frame));
        this.status.framesSent += 1;
        await delay(1);
      }
    } catch (error) {
      this.handleDisconnect(error);
    }
  }

  private handleDisconnect(error: unknown) {
    if (!this.running) return;
    const message = error instanceof Error ? error.message : String(error);
    this.port = undefined;
    this.directDevice = undefined;
    this.status = {
      state: "error",
      message: `DMX interface unavailable: ${message}`,
      framesSent: this.status.framesSent,
    };
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.running) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 2500);
    this.reconnectTimer.unref?.();
  }
}
