import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, dialog, Menu, nativeImage, shell, Tray } from "electron";
import { startConsoleServer, type RunningConsoleServer } from "../server/http-server";

const APP_ID = "com.open-dmx.console";
const SETTINGS_FILE = "desktop-settings.json";

interface DesktopSettings {
  startAtLogin: boolean;
}

let server: RunningConsoleServer | undefined;
let tray: Tray | undefined;
let settings: DesktopSettings = { startAtLogin: true };
let closing = false;

app.setAppUserModelId(APP_ID);
const ownsInstance = app.requestSingleInstanceLock();

function settingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

async function loadDesktopSettings() {
  try {
    const value = JSON.parse(await readFile(settingsPath(), "utf8")) as Partial<DesktopSettings>;
    return { startAtLogin: value.startAtLogin !== false };
  } catch {
    return { startAtLogin: true };
  }
}

async function saveDesktopSettings() {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function applyLoginSetting() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: settings.startAtLogin,
    ...(process.platform === "darwin"
      ? { type: "mainAppService" as const }
      : { path: process.execPath, args: ["--hidden"] }),
  });
}

function createTrayImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#171a1d"/><circle cx="12" cy="16" r="6" fill="none" stroke="#efb718" stroke-width="3"/><path d="M21 9v14M25 9v14" stroke="#efb718" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: 18, height: 18 });
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image;
}

async function openConsole() {
  if (server) await shell.openExternal(server.localUrl);
}

function rebuildTrayMenu() {
  if (!tray || !server) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Console", click: () => void openConsole() },
    { label: `Running on port ${server.port}`, enabled: false },
    { type: "separator" },
    {
      label: "Start at login",
      type: "checkbox",
      checked: settings.startAtLogin,
      click: (item) => {
        settings.startAtLogin = item.checked;
        applyLoginSetting();
        void saveDesktopSettings();
        rebuildTrayMenu();
      },
    },
    { label: "Open Data Folder", click: () => void shell.openPath(app.getPath("userData")) },
    { type: "separator" },
    { label: "Quit Open DMX Console", click: () => void quitApplication() },
  ]));
}

async function quitApplication() {
  if (closing) return;
  closing = true;
  try {
    await server?.close();
  } finally {
    server = undefined;
    app.quit();
  }
}

async function startDesktopHost() {
  const launchedAtLogin = process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAtLogin;
  settings = await loadDesktopSettings();
  applyLoginSetting();
  await saveDesktopSettings();

  process.env.OPEN_DMX_DATA_DIR = app.getPath("userData");
  const port = Number(process.env.PORT) || 3000;
  server = await startConsoleServer({
    projectRoot: app.getAppPath(),
    development: false,
    host: process.env.HOST || "0.0.0.0",
    port,
  });

  tray = new Tray(createTrayImage());
  tray.setToolTip("Open DMX Console");
  tray.on("double-click", () => void openConsole());
  rebuildTrayMenu();

  if (process.platform === "darwin") app.dock?.hide();
  if (!launchedAtLogin) await openConsole();
}

if (!ownsInstance) {
  app.quit();
} else {
  app.on("second-instance", () => void openConsole());

  app.whenReady()
    .then(startDesktopHost)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("Open DMX Console could not start", message);
      app.quit();
    });

  app.on("before-quit", (event) => {
    if (closing || !server) return;
    event.preventDefault();
    void quitApplication();
  });
}
