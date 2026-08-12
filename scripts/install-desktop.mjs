import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const outputDirectory = join(projectDirectory, "release", "install");
const packageJson = JSON.parse(readFileSync(join(projectDirectory, "package.json"), "utf8"));

function fail(message) {
  console.error(`\nDesktop installation failed: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

function findArtifact(directory, predicate) {
  if (!existsSync(directory)) {
    return undefined;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (predicate(entryPath, entry)) {
      return entryPath;
    }

    if (entry.isDirectory()) {
      const match = findArtifact(entryPath, predicate);
      if (match) return match;
    }
  }

  return undefined;
}

function buildInstaller(args) {
  rmSync(outputDirectory, { recursive: true, force: true });

  const electronBuilderCli = join(
    projectDirectory,
    "node_modules",
    "electron-builder",
    "cli.js",
  );

  if (!existsSync(electronBuilderCli)) {
    fail("electron-builder is not installed. Run npm install first.");
  }

  run(process.execPath, [
    electronBuilderCli,
    ...args,
    "--publish",
    "never",
    "--config.directories.output=release/install",
  ]);
}

function installMac() {
  const architecture = process.arch;
  if (architecture !== "arm64" && architecture !== "x64") {
    fail(`macOS architecture ${architecture} is not supported.`);
  }

  console.log(`\nBuilding the macOS ${architecture} application...`);
  buildInstaller(["--mac", "dir", `--${architecture}`]);

  const app = findArtifact(
    outputDirectory,
    (entryPath, entry) => entry.isDirectory() && entryPath.endsWith(".app"),
  );
  if (!app) fail("electron-builder did not produce an application bundle.");

  const installDirectory = resolve(process.env.OPEN_DMX_INSTALL_DIR || "/Applications");
  const destination = join(installDirectory, `${packageJson.build?.productName || "Open DMX Console"}.app`);
  const staging = join(installDirectory, `.Open DMX Console.installing-${process.pid}.app`);
  const backup = join(installDirectory, `.Open DMX Console.backup-${process.pid}.app`);

  console.log(`Installing ${destination}...`);

  try {
    mkdirSync(installDirectory, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    rmSync(backup, { recursive: true, force: true });
    run("ditto", [app, staging]);

    if (existsSync(destination)) {
      renameSync(destination, backup);
    }

    try {
      renameSync(staging, destination);
    } catch (error) {
      if (existsSync(backup) && !existsSync(destination)) {
        renameSync(backup, destination);
      }
      throw error;
    }

    try {
      rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Installed successfully, but could not remove the old backup at ${backup}: ${error.message}`);
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    fail(`${error.message} Set OPEN_DMX_INSTALL_DIR to a writable Applications directory if needed.`);
  }

  console.log(`\nInstalled Open DMX Console ${packageJson.version} at ${destination}`);
  console.log("Quit and reopen the application if an older version is currently running.");
}

function installWindows() {
  if (process.arch !== "x64" && process.arch !== "arm64") {
    fail(`Windows architecture ${process.arch} is not supported.`);
  }

  console.log("\nBuilding the Windows x64 installer...");
  buildInstaller(["--win", "nsis", "--x64"]);

  const installer = findArtifact(
    outputDirectory,
    (entryPath, entry) => entry.isFile() && entryPath.endsWith("-setup.exe"),
  );
  if (!installer) fail("electron-builder did not produce an NSIS setup executable.");

  console.log(`Installing with ${installer}...`);
  const installerArgs = ["/S"];
  if (process.env.OPEN_DMX_INSTALL_DIR) {
    // NSIS requires /D to be the final argument.
    installerArgs.push(`/D=${resolve(process.env.OPEN_DMX_INSTALL_DIR)}`);
  }
  run(installer, installerArgs);

  console.log(`\nInstalled Open DMX Console ${packageJson.version}.`);
  console.log("Quit and reopen the application if an older version is currently running.");
}

try {
  if (process.platform === "darwin") {
    installMac();
  } else if (process.platform === "win32") {
    installWindows();
  } else {
    fail(`platform ${process.platform} is not supported; use macOS or Windows.`);
  }
} catch (error) {
  fail(error.message);
}
