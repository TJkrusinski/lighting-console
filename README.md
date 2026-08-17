# Open DMX Console

A focused, single-universe lighting console for an ENTTEC Open DMX USB interface. A Vite-powered React UI runs in the browser; an Express/Node.js process owns the API, stores the patch and presets, performs fades, and continuously streams DMX through the FTDI interface.

## Installable desktop app

The desktop build is a per-user background application for macOS and Windows. It bundles Node.js, the web UI, API server, and native DMX drivers, so the destination computer does not need Node, npm, or PM2 installed.

### Get the installer

This repository does not currently publish installers to a public download page. Obtain the appropriate artifact from the person or team distributing the console, or [build it locally](#build-installers). A public release should attach the generated files and replace this notice with its download link.

Installer filenames include the application version, operating system, and processor architecture:

| Platform | Recommended artifact | Other artifact |
| --- | --- | --- |
| Apple silicon Mac | `Open-DMX-Console-VERSION-mac-arm64.dmg` | `Open-DMX-Console-VERSION-mac-arm64.zip` |
| Intel Mac | `Open-DMX-Console-VERSION-mac-x64.dmg` | `Open-DMX-Console-VERSION-mac-x64.zip` |
| 64-bit Windows | `Open-DMX-Console-VERSION-win-x64-setup.exe` | `Open-DMX-Console-VERSION-win-x64-portable.exe` |

Use the DMG on macOS and the setup executable on Windows for a permanent installation. The ZIP and portable executable are intended for testing or running without a conventional install.

### Install it

- **macOS:** open the DMG, drag **Open DMX Console** to Applications, then launch it. These development builds are unsigned, so the first launch may require Control-clicking the app and choosing **Open**.
- **Windows:** run the `Open-DMX-Console-VERSION-win-x64-setup.exe` artifact, choose the install location, and launch **Open DMX Console**. Windows SmartScreen may warn about an unsigned development build.
- Connect the ENTTEC Open DMX USB interface before launch. On Windows, install the current FTDI driver if the interface is not detected.
- Stop any source or PM2 instance first. Only one process can use port 3000 and the Open DMX USB interface at a time.

After installation:

- The first ordinary launch opens the console in the default browser. Login launches stay in the background.
- Use the tray/menu-bar icon to open the console, open its data folder, toggle **Start at login**, or quit. Quitting cleanly releases the Open DMX USB interface.
- The HTTP server still listens on port 3000 on localhost and all LAN interfaces, so Companion and other VLAN devices work exactly as they do in source mode.

Start at login is enabled on first launch. It can be disabled at any time from the tray menu. This is deliberately a user-login background app, not a privileged system service: USB access and the tray controls belong in the logged-in desktop session.

Packaged state is stored in the operating system's application-data directory:

- macOS: `~/Library/Application Support/Open DMX Console/console-state.json`
- Windows: `%APPDATA%\Open DMX Console\console-state.json`

When moving from a source checkout, use **Companion setup → Export everything**, launch the installed app, and import that JSON backup. Source mode continues to use `.data/console-state.json`.

### Build installers

Install dependencies once, then build on the target operating system:

```bash
npm install
npm run desktop:install # build and install for this computer
npm run desktop:mac   # macOS: Apple Silicon + Intel DMG and ZIP
npm run desktop:win   # Windows: NSIS installer and portable EXE
```

`npm run desktop:install` builds only the current machine's required application, then installs it in `/Applications` on macOS or runs the Windows per-user installer silently. Quit and reopen an already-running copy to start the new version. Set `OPEN_DMX_INSTALL_DIR` to override the destination directory.

Artifacts are written to `release/`. `npm run desktop:dist` builds the configured artifacts for the current operating system, while `npm run desktop:dir` creates an unpacked application for quick local testing.

The local artifacts are unsigned. Public distribution should add Apple Developer ID signing/notarization and a Windows code-signing certificate; otherwise macOS Gatekeeper and Windows SmartScreen may warn on first launch.

## Source requirements

- macOS or Windows
- Node.js 22.13 or newer
- An ENTTEC Open DMX USB (FT232R-based) interface
- A DMX cable/adapter appropriate for each fixture

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The server listens on all network interfaces by default, so other devices on the same LAN can open `http://COMPUTER-IP:3000`. The console automatically looks for USB vendor/product `0403:6001`.

For a production build without a process manager:

```bash
npm run build
npm start
```

### Run continuously with PM2

PM2 keeps the console alive after terminal disconnects and restarts it if the process crashes. The included configuration runs one instance on all network interfaces at port 3000.

```bash
npm run build
npm run pm2:start
```

Useful commands:

```bash
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
npx pm2 save
```

On macOS, `npx pm2 startup` prints the command needed to restore the saved process list after reboot. On Windows, use Task Scheduler to run `npx pm2 resurrect` at login or startup.

The source-run app saves its state to `.data/console-state.json`.

### Device overrides

- macOS example: `OPEN_DMX_SERIAL=BH0008SM npm run dev`
- Windows PowerShell: `$env:OPEN_DMX_SERIAL='BH0008SM'; npm run dev`
- Preview without hardware: set `OPEN_DMX_DISABLED=1`

On Windows, install the current FTDI driver if the interface is not discovered. Do not run two DMX applications against the same interface.

### Direct DMX output test

Stop the web console first so the diagnostic can open the serial port, then run:

```bash
npm run pm2:stop
npm run test-dmx
```

The test uses the first patched fixture's address and footprint, sends six visible level/parameter combinations, restores the saved console values, and reports the number of frames transmitted. Override its target when needed:

```bash
npm run test-dmx -- --start 1 --channels 2 --hold 2000
```

You can select a specific macOS/Windows interface with `--serial BH0008SM`. The Linux serial fallback accepts `--port /dev/ttyUSB0`. A fixture displaying **No data** is not seeing a valid DMX electrical signal; address or profile errors do not normally produce that message. Check the fixture's physical DMX input, cable/pinout, and terminator after confirming that this test reports advancing frames.

## Console workflow

1. In **Universe editor**, add fixtures, select a mode, and set non-overlapping DMX addresses.
2. In **Preset manager**, use the fixture controls to build a look.
3. Set the transition time and capture the current 512-channel state.
4. Recall a preset from the UI or over HTTP. Values are linearly interpolated from the live universe to the captured state.

The **Companion setup** page inside the console detects the computer's LAN URL, explains the complete setup, and provides copyable discovery and preset-recall paths.

Included profiles:

- amaran F21x: CCT 8-bit and FX 8-bit
- Godox KNOWLED F200Bi K2: CCT, FX, and Ultimate 8-bit
- Godox KNOWLED F600Bi: CCT 8-bit and FX 8-bit
- Aputure STORM 80c: CCT + RGB 8-bit (Aputure Profile 1)
- Aputure STORM 700x: Profiles 1, 3, and 5 (8-bit CCT+, control, and FX/control)

## Companion and HTTP control

The Companion endpoints are intentionally unauthenticated and the server listens on the LAN by default. Keep the service on a trusted production LAN and do not expose it directly to the internet.

List presets:

```text
GET http://CONSOLE-IP:3000/api/companion/presets
```

Recall a preset using the console's current transition time:

```text
GET http://CONSOLE-IP:3000/api/companion/recall/PRESET_ID
```

Override the transition per button:

```text
GET http://CONSOLE-IP:3000/api/companion/recall/PRESET_ID?seconds=2.5
GET http://CONSOLE-IP:3000/api/companion/recall/PRESET_ID?transitionMs=2500
```

`POST` works on the same recall URL as well. In Bitfocus Companion, a **Generic HTTP** connection can call these GET URLs directly; a custom Companion module is not required for basic recall. Preset cards in the UI display the full URL to paste into a button action.

Additional application endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Lightweight service and DMX output health (`200`, `503`, or `500`) |
| `GET` | `/api/console/state` | Full console, output, and device state |
| `POST` | `/api/console/live` | Set channels with `{ "values": { "1": 255 } }` |
| `POST` | `/api/console/fixtures` | Replace the fixture patch |
| `POST` | `/api/console/presets` | Capture a preset with `{ "name": "Interview" }` |
| `GET/POST` | `/api/console/presets/:id/recall` | Recall a preset |
| `POST` | `/api/console/presets/:id/overwrite` | Replace a preset's values with the current live universe |
| `DELETE` | `/api/console/presets/:id` | Delete a preset |
| `GET` | `/api/console/health` | DMX device health |
| `GET` | `/api/console/export` | Download the complete console state as JSON |
| `POST` | `/api/console/import` | Replace the complete console state from an exported backup |

`GET /health` reads the in-memory output status and does not rescan or reopen the USB device. It returns `200` when the configured output is operational (including intentional `OPEN_DMX_DISABLED` simulation mode), `503 Service Unavailable` when the interface is missing, reconnecting, or has not sent a frame in the last two seconds, and `500 Internal Server Error` if the console engine itself cannot initialize.

The **Companion setup** page also provides **Export everything** and **Import backup** controls. Import validates the complete file before replacing the current fixture patch, presets, live universe values, and transition setting.

## Open DMX implementation

On macOS and Windows, the transport uses Node's direct FTDI D2XX binding, matching QLC+'s working Open DMX backend. It configures 250,000 baud, 8 data bits, no parity, 2 stop bits, no flow control, and RTS low. Each 30 Hz universe packet has a 110-microsecond break, a 16-microsecond mark-after-break, the null start code, and all 512 channel bytes. Linux retains a `serialport` fallback.

Open DMX is an output-only, host-timed interface. Unlike the ENTTEC DMX USB Pro, it has no packet protocol or onboard frame timing, so the computer must remain awake and the Node process must keep running.

## Application architecture

- `src/`: Vite and React browser application
- `server/api.ts`: Express API routes, including Companion endpoints
- `server/open-dmx.ts`: direct FTDI/serial DMX transport
- `server/http-server.ts`: reusable HTTP/API/frontend lifecycle used by the CLI and desktop app
- `server/index.ts`: command-line host for the server
- `desktop/main.ts`: tray host, browser launch, login startup, and clean shutdown
- `electron-builder.yml`: macOS and Windows packaging targets
- `ecosystem.config.cjs`: single-instance PM2 process definition and graceful shutdown settings

Development uses the Vite middleware inside Express, so there is only one server and one port. Production builds static browser assets into `dist/` and the bundled Node server into `dist-server/`.

## Verify

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
